import { z } from "zod";
import type { McpNotification, McpRequestClient, McpRequestOptions } from "./http";

const AnnotationsSchema = z.record(z.string(), z.unknown());

export const McpResourceSchema = z.object({
  uri: z.string().min(1),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  annotations: AnnotationsSchema.optional(),
});

export const McpResourceTemplateSchema = z.object({
  uriTemplate: z.string().min(1),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  annotations: AnnotationsSchema.optional(),
});

const ResourceTextSchema = z.object({
  uri: z.string().min(1),
  mimeType: z.string().optional(),
  text: z.string(),
});

const ResourceBlobSchema = z.object({
  uri: z.string().min(1),
  mimeType: z.string().optional(),
  blob: z.string(),
});

export const McpResourceDataSchema = z.union([ResourceTextSchema, ResourceBlobSchema]);

export type McpResourceData = z.infer<typeof McpResourceDataSchema>;

export type McpResourceContent =
  | { kind: "text"; uri: string; mimeType?: string; text: string }
  | { kind: "blob"; uri: string; mimeType?: string; blob: string };

export function resourceContent(data: McpResourceData): McpResourceContent {
  return "text" in data
    ? {
        kind: "text",
        uri: data.uri,
        ...(data.mimeType === undefined ? {} : { mimeType: data.mimeType }),
        text: data.text,
      }
    : {
        kind: "blob",
        uri: data.uri,
        ...(data.mimeType === undefined ? {} : { mimeType: data.mimeType }),
        blob: data.blob,
      };
}

const McpResourceContentSchema = McpResourceDataSchema.transform(resourceContent);

const ListResourcesResultSchema = z.object({
  resources: z.array(McpResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

const ListResourceTemplatesResultSchema = z.object({
  resourceTemplates: z.array(McpResourceTemplateSchema),
  nextCursor: z.string().min(1).optional(),
});

const ReadResourceResultSchema = z.object({
  contents: z.array(McpResourceContentSchema).min(1),
});

export type McpResource = z.infer<typeof McpResourceSchema>;
export type McpResourceTemplate = z.infer<typeof McpResourceTemplateSchema>;

export interface McpResourcePage {
  resources: McpResource[];
  nextCursor?: string | undefined;
}

export interface McpResourceTemplatePage {
  resourceTemplates: McpResourceTemplate[];
  nextCursor?: string | undefined;
}

export interface McpResourceCatalogOptions {
  maxPages?: number;
}

function invalid(method: string, error: z.ZodError): Error {
  return new Error(`MCP ${method} returned invalid data: ${error.message}`);
}

function options(signal: AbortSignal | undefined): McpRequestOptions {
  return signal === undefined ? {} : { signal };
}

export class McpResourceCatalog {
  readonly #client: McpRequestClient;
  readonly #maxPages: number;
  readonly #listeners = new Set<() => void>();
  #unsubscribe: (() => void) | undefined;
  #resources: McpResource[] | undefined;
  #templates: McpResourceTemplate[] | undefined;
  #generation = 0;
  #closed = false;

  constructor(client: McpRequestClient, catalogOptions: McpResourceCatalogOptions = {}) {
    this.#client = client;
    this.#maxPages = Math.max(1, catalogOptions.maxPages ?? 16);
    this.#unsubscribe = client.onNotification((notification) => {
      this.handleNotification(notification);
    });
  }

  async listResources(
    params: { cursor?: string } = {},
    signal?: AbortSignal,
  ): Promise<McpResourcePage> {
    const result = await this.#client.request(
      "resources/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options(signal),
    );
    const parsed = ListResourcesResultSchema.safeParse(result);
    if (!parsed.success) throw invalid("resources/list", parsed.error);
    return parsed.data;
  }

  async listAllResources(signal?: AbortSignal): Promise<McpResource[]> {
    if (this.#resources !== undefined) return this.#resources;
    const generation = this.#generation;
    const collected: McpResource[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < this.#maxPages; page += 1) {
      const result = await this.listResources(cursor === undefined ? {} : { cursor }, signal);
      collected.push(...result.resources);
      if (result.nextCursor === undefined) {
        if (generation === this.#generation) this.#resources = collected;
        return collected;
      }
      if (seen.has(result.nextCursor)) {
        throw new Error(`MCP resources/list repeated cursor "${result.nextCursor}"`);
      }
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }

    throw new Error(`MCP resources/list exceeded ${this.#maxPages} pages`);
  }

  async listResourceTemplates(
    params: { cursor?: string } = {},
    signal?: AbortSignal,
  ): Promise<McpResourceTemplatePage> {
    const result = await this.#client.request(
      "resources/templates/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options(signal),
    );
    const parsed = ListResourceTemplatesResultSchema.safeParse(result);
    if (!parsed.success) throw invalid("resources/templates/list", parsed.error);
    return parsed.data;
  }

  async listAllResourceTemplates(signal?: AbortSignal): Promise<McpResourceTemplate[]> {
    if (this.#templates !== undefined) return this.#templates;
    const generation = this.#generation;
    const collected: McpResourceTemplate[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < this.#maxPages; page += 1) {
      const result = await this.listResourceTemplates(
        cursor === undefined ? {} : { cursor },
        signal,
      );
      collected.push(...result.resourceTemplates);
      if (result.nextCursor === undefined) {
        if (generation === this.#generation) this.#templates = collected;
        return collected;
      }
      if (seen.has(result.nextCursor)) {
        throw new Error(`MCP resources/templates/list repeated cursor "${result.nextCursor}"`);
      }
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }

    throw new Error(`MCP resources/templates/list exceeded ${this.#maxPages} pages`);
  }

  async readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContent[]> {
    if (uri.trim().length === 0) throw new Error("MCP resource uri is required");
    const result = await this.#client.request("resources/read", { uri }, options(signal));
    const parsed = ReadResourceResultSchema.safeParse(result);
    if (!parsed.success) throw invalid("resources/read", parsed.error);
    return parsed.data.contents;
  }

  handleNotification(notification: McpNotification): boolean {
    if (notification.method !== "notifications/resources/list_changed") return false;
    this.invalidate();
    return true;
  }

  invalidate(): void {
    if (this.#closed) return;
    this.#generation += 1;
    this.#resources = undefined;
    this.#templates = undefined;
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
    this.#resources = undefined;
    this.#templates = undefined;
  }
}
