// The agent-one model list: a Next.js page whose data ships as JSON inside script chunks.
// The page is decoded and parsed as JSON objects and checked by a schema, never pattern-matched.
import { z } from "zod";
import { type ModelConfig, ModelConfigSchema } from "../config/schema";
import { formatModelName } from "../util/model-name";
import {
  CatalogError,
  type CatalogLoadOptions,
  loadSource,
  type SourceSpec,
} from "./catalog-source";

const AGENT_ONE_URL = "https://models.agent-one.dev/list";
const FLIGHT = "self.__next_f.push([1,";
const ID_OBJECT = '{"id":"';

const ModelSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  features: z
    .looseObject({
      reasoning: z.boolean().optional(),
      tool_call: z.boolean().optional(),
      attachment: z.boolean().optional(),
    })
    .optional(),
  limit: z
    .looseObject({ context: z.number().optional(), output: z.number().optional() })
    .optional(),
});
type RawModel = z.infer<typeof ModelSchema>;

const ProviderSchema = z.looseObject({ id: z.string(), models: z.record(z.string(), z.unknown()) });

/** Index of the quote that closes the JSON string opened at `start`, or -1. */
function stringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === '"') return index;
  }
  return -1;
}

/** Index right after the brace that closes the object opened at `start`, or -1. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      index = stringEnd(text, index);
      if (index < 0) return -1;
    } else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** The page data: decoded script chunks joined in order; a plain JSON body passes through. */
function pageData(raw: string): string {
  if (!raw.includes(FLIGHT)) return raw;
  const parts: string[] = [];
  let from = 0;
  for (let at = raw.indexOf(FLIGHT); at >= 0; at = raw.indexOf(FLIGHT, from)) {
    const start = at + FLIGHT.length;
    const end = raw[start] === '"' ? stringEnd(raw, start) : -1;
    if (end < 0) {
      from = start;
      continue;
    }
    try {
      parts.push(JSON.parse(raw.slice(start, end + 1)) as string);
    } catch {}
    from = end + 1;
  }
  return parts.join("");
}

/** Top-level JSON objects that start with an id: providers with models, or bare models. */
function* idObjects(text: string): Generator<unknown> {
  let from = 0;
  for (let at = text.indexOf(ID_OBJECT); at >= 0; at = text.indexOf(ID_OBJECT, from)) {
    const end = objectEnd(text, at);
    if (end < 0) return;
    try {
      yield JSON.parse(text.slice(at, end));
      from = end;
    } catch {
      from = at + ID_OBJECT.length;
    }
  }
}

function rawModels(text: string): RawModel[] {
  const out: RawModel[] = [];
  for (const value of idObjects(text)) {
    const provider = ProviderSchema.safeParse(value);
    const candidates = provider.success ? Object.values(provider.data.models) : [value];
    for (const candidate of candidates) {
      const model = ModelSchema.safeParse(candidate);
      if (model.success && (model.data.features || model.data.limit)) out.push(model.data);
    }
  }
  return out;
}

/** One entry per id: a stated name, the largest limits and every capability any listing confirmed. */
function merge(previous: ModelConfig | undefined, raw: RawModel): ModelConfig | undefined {
  const context = Math.max(previous?.context ?? 0, raw.limit?.context ?? 0);
  const output = Math.max(previous?.output ?? 0, raw.limit?.output ?? 0);
  const flag = (before: boolean | undefined, now: boolean | undefined) =>
    before === true || now === true ? true : before === false || now === false ? false : undefined;
  const reasoning = flag(previous?.reasoning, raw.features?.reasoning);
  const tools = flag(previous?.tools, raw.features?.tool_call);
  const candidate: ModelConfig = {
    name: raw.name && raw.name !== raw.id ? raw.name : (previous?.name ?? formatModelName(raw.id)),
    ...(context > 0 ? { context } : {}),
    ...(output > 0 ? { output } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(previous?.vision === true || raw.features?.attachment === true ? { vision: true } : {}),
    source: "agent-one",
  };
  const parsed = ModelConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : previous;
}

export function parseAgentOne(raw: unknown): Record<string, ModelConfig> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const output: Record<string, ModelConfig> = {};
    for (const [id, value] of Object.entries(raw)) {
      const parsed = ModelConfigSchema.safeParse(value);
      if (parsed.success) output[id] = parsed.data;
    }
    return output;
  }
  if (typeof raw !== "string") throw new CatalogError("agent-one", "expected an HTML list");
  const output: Record<string, ModelConfig> = {};
  for (const model of rawModels(pageData(raw))) {
    const merged = merge(output[model.id], model);
    if (merged) output[model.id] = merged;
  }
  return output;
}

const agentOneSource: SourceSpec<Record<string, ModelConfig>> = {
  name: "agent-one",
  file: "agent-one.json",
  url: AGENT_ONE_URL,
  accept: "text/html",
  read: (response) => response.text() as Promise<unknown>,
  parse: parseAgentOne,
  empty: (value) => Object.keys(value).length === 0,
  cacheValue: "value",
};

export async function loadAgentOne(
  cwd: string,
  force = false,
  options: CatalogLoadOptions = {},
): Promise<Record<string, ModelConfig>> {
  const value = await loadSource(cwd, agentOneSource, {
    ...options,
    force: force || options.force === true,
  });
  return value ?? {};
}
