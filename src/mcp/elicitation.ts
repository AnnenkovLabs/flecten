import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { z } from "zod";

const formValidator = new AjvJsonSchemaValidator();

const RequestedSchemaSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

const FormRequestSchema = z
  .object({
    mode: z.literal("form").optional(),
    message: z.string().min(1).max(4000),
    requestedSchema: RequestedSchemaSchema,
  })
  .catchall(z.unknown());

const UrlRequestSchema = z
  .object({
    mode: z.literal("url"),
    message: z.string().min(1).max(4000),
    elicitationId: z.string().min(1).max(512),
    url: z.string().url(),
  })
  .catchall(z.unknown());

const ElicitationParamsSchema = z.union([FormRequestSchema, UrlRequestSchema]);

const ElicitationValueSchema = z.union([
  z.string().max(8192),
  z.number(),
  z.boolean(),
  z.array(z.string().max(8192)).max(128),
]);

export const McpElicitationResponseSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
  content: z.record(z.string().min(1).max(128), ElicitationValueSchema).optional(),
});

export type McpElicitationAction = z.infer<typeof McpElicitationResponseSchema>["action"];
export type McpElicitationResponse = z.infer<typeof McpElicitationResponseSchema>;
export type McpElicitationParams = z.infer<typeof ElicitationParamsSchema>;

export interface McpElicitationRequest {
  id: string;
  server: string;
  createdAt: number;
  mode: "form" | "url";
  message: string;
  requestedSchema?: z.infer<typeof RequestedSchemaSchema>;
  url?: string;
  elicitationId?: string;
}

export type McpElicitationErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "too_many_pending"
  | "closed";

export class McpElicitationError extends Error {
  readonly code: McpElicitationErrorCode;

  constructor(code: McpElicitationErrorCode, message: string) {
    super(message);
    this.name = "McpElicitationError";
    this.code = code;
  }
}

export interface McpElicitationBrokerOptions {
  now?: () => number;
  maxPending?: number;
}

interface PendingElicitation {
  request: McpElicitationRequest;
  resolve: (response: McpElicitationResponse) => void;
  signal?: AbortSignal | undefined;
  onAbort?: (() => void) | undefined;
}

export class McpElicitationBroker {
  readonly #now: () => number;
  readonly #maxPending: number;
  readonly #pending = new Map<string, PendingElicitation>();
  readonly #listeners = new Set<(requests: McpElicitationRequest[]) => void>();
  #nextId = 1;
  #closed = false;

  constructor(options: McpElicitationBrokerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxPending = Math.max(1, options.maxPending ?? 16);
  }

  pending(): McpElicitationRequest[] {
    return [...this.#pending.values()].map((entry) => entry.request);
  }

  onChange(listener: (requests: McpElicitationRequest[]) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  request(server: string, params: unknown, signal?: AbortSignal): Promise<McpElicitationResponse> {
    if (this.#closed) {
      return Promise.reject(new McpElicitationError("closed", "MCP elicitation is closed"));
    }
    const parsed = ElicitationParamsSchema.safeParse(params);
    if (!parsed.success) {
      return Promise.reject(
        new McpElicitationError(
          "invalid_request",
          `MCP elicitation request is invalid: ${parsed.error.message}`,
        ),
      );
    }
    if (this.#pending.size >= this.#maxPending) {
      return Promise.reject(
        new McpElicitationError(
          "too_many_pending",
          `MCP elicitation already has ${this.#maxPending} pending requests`,
        ),
      );
    }
    if (signal?.aborted) return Promise.resolve({ action: "cancel" });

    const value = parsed.data;
    const requestedSchema = (value as { requestedSchema?: z.infer<typeof RequestedSchemaSchema> })
      .requestedSchema;
    const url = (value as { url?: string }).url;
    const elicitationId = (value as { elicitationId?: string }).elicitationId;
    const request: McpElicitationRequest = {
      id: `elicit_${this.#nextId}`,
      server,
      createdAt: this.#now(),
      mode: url === undefined ? "form" : "url",
      message: value.message,
      ...(requestedSchema === undefined ? {} : { requestedSchema }),
      ...(url === undefined ? {} : { url }),
      ...(elicitationId === undefined ? {} : { elicitationId }),
    };
    this.#nextId += 1;

    return new Promise<McpElicitationResponse>((resolve) => {
      const entry: PendingElicitation = { request, resolve };
      if (signal !== undefined) {
        const onAbort = (): void => {
          if (!this.#pending.delete(request.id)) return;
          resolve({ action: "cancel" });
          this.#emit();
        };
        entry.signal = signal;
        entry.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.#pending.set(request.id, entry);
      this.#emit();
    });
  }

  answer(id: string, response: unknown): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    const parsed = McpElicitationResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new McpElicitationError(
        "invalid_response",
        `MCP elicitation response is invalid: ${parsed.error.message}`,
      );
    }
    if (parsed.data.action === "accept" && entry.request.mode === "form") {
      const schema: Record<string, unknown> | undefined = entry.request.requestedSchema;
      if (schema) {
        const validation = formValidator.getValidator(schema)(parsed.data.content ?? {});
        if (!validation.valid)
          throw new McpElicitationError(
            "invalid_response",
            `MCP form response does not match the requested fields: ${validation.errorMessage}`,
          );
      }
    }
    this.#pending.delete(id);
    this.#detach(entry);
    entry.resolve(parsed.data);
    this.#emit();
    return true;
  }

  cancel(id: string): boolean {
    return this.answer(id, { action: "cancel" });
  }

  cancelServer(server: string): number {
    let cancelled = 0;
    for (const entry of [...this.#pending.values()]) {
      if (entry.request.server !== server) continue;
      this.#pending.delete(entry.request.id);
      this.#detach(entry);
      entry.resolve({ action: "cancel" });
      cancelled += 1;
    }
    if (cancelled > 0) this.#emit();
    return cancelled;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#pending.values()) {
      this.#detach(entry);
      entry.resolve({ action: "cancel" });
    }
    this.#pending.clear();
    this.#listeners.clear();
  }

  #detach(entry: PendingElicitation): void {
    if (entry.signal !== undefined && entry.onAbort !== undefined) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
  }

  #emit(): void {
    const requests = this.pending();
    for (const listener of this.#listeners) listener(requests);
  }
}
