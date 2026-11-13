import { z } from "zod";
import type { McpNotification, McpRequestClient, McpRequestOptions } from "./http";
import { McpResourceDataSchema, resourceContent } from "./resources";

const PromptTextSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const PromptImageSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});

const PromptAudioSchema = z.object({
  type: z.literal("audio"),
  data: z.string(),
  mimeType: z.string(),
});

const PromptResourceSchema = z
  .object({
    type: z.literal("resource"),
    resource: McpResourceDataSchema,
  })
  .transform((value) => ({
    type: "resource" as const,
    resource: resourceContent(value.resource),
  }));

const PromptResourceLinkSchema = z.object({
  type: z.literal("resource_link"),
  uri: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

export const McpPromptContentSchema = z.union([
  PromptTextSchema,
  PromptImageSchema,
  PromptAudioSchema,
  PromptResourceSchema,
  PromptResourceLinkSchema,
]);

export const McpPromptMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: McpPromptContentSchema,
});

const McpPromptArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

export const McpPromptSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  arguments: z.array(McpPromptArgumentSchema).optional(),
});

const ListPromptsResultSchema = z.object({
  prompts: z.array(McpPromptSchema),
  nextCursor: z.string().min(1).optional(),
});

const GetPromptResultSchema = z.object({
  description: z.string().optional(),
  messages: z.array(McpPromptMessageSchema),
});

const PromptArgumentsSchema = z.record(z.string().min(1), z.string());

export type McpPromptContent = z.infer<typeof McpPromptContentSchema>;
export type McpPromptMessage = z.infer<typeof McpPromptMessageSchema>;
export type McpPrompt = z.infer<typeof McpPromptSchema>;
export type McpPromptArgument = z.infer<typeof McpPromptArgumentSchema>;

export interface McpPromptPage {
  prompts: McpPrompt[];
  nextCursor?: string | undefined;
}

export interface McpPromptResult {
  description?: string | undefined;
  messages: McpPromptMessage[];
}

export interface McpPromptCatalogOptions {
  maxPages?: number;
}

function invalid(method: string, error: z.ZodError): Error {
  return new Error(`MCP ${method} returned invalid data: ${error.message}`);
}

function options(signal: AbortSignal | undefined): McpRequestOptions {
  return signal === undefined ? {} : { signal };
}

export class McpPromptCatalog {
  readonly #client: McpRequestClient;
  readonly #maxPages: number;
  readonly #listeners = new Set<() => void>();
  #unsubscribe: (() => void) | undefined;
  #prompts: McpPrompt[] | undefined;
  #generation = 0;
  #closed = false;

  constructor(client: McpRequestClient, catalogOptions: McpPromptCatalogOptions = {}) {
    this.#client = client;
    this.#maxPages = Math.max(1, catalogOptions.maxPages ?? 16);
    this.#unsubscribe = client.onNotification((notification) => {
      this.handleNotification(notification);
    });
  }

  async listPrompts(
    params: { cursor?: string } = {},
    signal?: AbortSignal,
  ): Promise<McpPromptPage> {
    const result = await this.#client.request(
      "prompts/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options(signal),
    );
    const parsed = ListPromptsResultSchema.safeParse(result);
    if (!parsed.success) throw invalid("prompts/list", parsed.error);
    return parsed.data;
  }

  async listAllPrompts(signal?: AbortSignal): Promise<McpPrompt[]> {
    if (this.#prompts !== undefined) return this.#prompts;
    const generation = this.#generation;
    const collected: McpPrompt[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < this.#maxPages; page += 1) {
      const result = await this.listPrompts(cursor === undefined ? {} : { cursor }, signal);
      collected.push(...result.prompts);
      if (result.nextCursor === undefined) {
        if (generation === this.#generation) this.#prompts = collected;
        return collected;
      }
      if (seen.has(result.nextCursor)) {
        throw new Error(`MCP prompts/list repeated cursor "${result.nextCursor}"`);
      }
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }

    throw new Error(`MCP prompts/list exceeded ${this.#maxPages} pages`);
  }

  async getPrompt(
    name: string,
    args: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<McpPromptResult> {
    if (name.trim().length === 0) throw new Error("MCP prompt name is required");
    const parsedArgs = PromptArgumentsSchema.safeParse(args);
    if (!parsedArgs.success) {
      throw new Error("MCP prompt arguments must be a record of strings");
    }
    const params: Record<string, unknown> = { name };
    if (Object.keys(parsedArgs.data).length > 0) params.arguments = parsedArgs.data;
    const result = await this.#client.request("prompts/get", params, options(signal));
    const parsed = GetPromptResultSchema.safeParse(result);
    if (!parsed.success) throw invalid("prompts/get", parsed.error);
    return parsed.data;
  }

  handleNotification(notification: McpNotification): boolean {
    if (notification.method !== "notifications/prompts/list_changed") return false;
    this.invalidate();
    return true;
  }

  invalidate(): void {
    if (this.#closed) return;
    this.#generation += 1;
    this.#prompts = undefined;
    for (const listener of this.#listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
    this.#prompts = undefined;
  }
}
