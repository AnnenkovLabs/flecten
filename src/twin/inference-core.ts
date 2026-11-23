import { z } from "zod";
import delegatePrompt from "../../prompts/twin-delegate.md" with { type: "text" };
import {
  TwinCandidateSchema,
  TwinDecisionSchema,
  type TwinDelegateInput,
  TwinReactionSchema,
  type TwinSnapshot,
  type TwinTraceStep,
} from "../../shared/twin";
import type { StructuredOutputFormat } from "../config/schema";
import { toolMessage } from "../core/loop/tool-message";
import { safeMemoryText } from "../core/memory/sources";
import type { ImagePart, Message, ReasoningEffort, ToolCall, Usage } from "../core/types";
import { addUsage } from "../core/types/message";
import { type ProviderResponse, responseOfError } from "../providers/response";
import { TransportError } from "../providers/transport";
import type { ModelProvider } from "../providers/types";
import { markdownData } from "../util/markdown";
import { TwinInferenceError } from "./inference-error";
import { twinResponse } from "./response";
import { buildTwinTools, type TwinToolOptions } from "./tools";

export type { TwinToolOptions } from "./tools";

export const TWIN_DECISION_FORMAT: StructuredOutputFormat = {
  name: "twin_decision",
  strict: true,
  schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "revise", "ask_user"] },
      voice: { type: "string" },
      instructions: { type: "string" },
      entryIds: { type: "array", items: { type: "string" } },
      emotion: { type: "string", enum: ["calm", "pleased", "angry", "furious"] },
    },
    required: ["verdict", "voice", "instructions", "entryIds", "emotion"],
    additionalProperties: false,
  },
};

export const TWIN_EXTRACTION_FORMAT: StructuredOutputFormat = {
  name: "twin_extraction",
  strict: true,
  schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["preference", "lesson", "decision"] },
            reaction: { type: "string", enum: ["anger", "like", "delight"] },
            strength: { type: "integer", minimum: 1, maximum: 3 },
            voice: { type: "string" },
            summary: { type: "string" },
            content: { type: "string" },
            appliesWhen: { type: "string" },
            evidence: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sourceMessageId: { type: "string" },
                  quote: { type: "string" },
                },
                required: ["sourceMessageId", "quote"],
                additionalProperties: false,
              },
            },
          },
          required: [
            "kind",
            "reaction",
            "strength",
            "voice",
            "summary",
            "content",
            "appliesWhen",
            "evidence",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  },
};

export const proposed = TwinCandidateSchema.omit({ id: true, evidence: true }).extend({
  reaction: TwinReactionSchema,
  strength: z.number().int().min(1).max(3),
  voice: z.string().min(1).max(600),
  evidence: z
    .array(
      z.object({ sourceMessageId: z.string().min(1), quote: z.string().min(1).max(4000) }).strict(),
    )
    .min(1)
    .max(4),
});
export const extraction = z.object({ candidates: z.array(proposed).max(16) }).strict();

export interface InferenceTarget {
  provider: ModelProvider;
  model: string;
  providerId: string;
  reasoning?: ReasoningEffort | undefined;
  variant?: string | undefined;
  cwd?: string | undefined;
  modalities?: readonly string[] | undefined;
  price(usage: Usage): number | undefined;
  priceFor?(provider: string, model: string): ((usage: Usage) => number | undefined) | undefined;
}

function traceDetail(name: string, args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const record = args as Record<string, unknown>;
  if (name === "read" && typeof record.path === "string") return record.path;
  if (name === "grep" && typeof record.pattern === "string") {
    return typeof record.path === "string" ? `${record.pattern} (${record.path})` : record.pattern;
  }
  if (name === "glob" && typeof record.pattern === "string") return record.pattern;
  if (name === "inspect_messages") {
    if (typeof record.query === "string") return record.query;
    if (Array.isArray(record.ids)) return `${record.ids.length} message(s)`;
  }
  return undefined;
}

export async function infer(
  target: InferenceTarget,
  system: string,
  data: string,
  signal: AbortSignal,
  images: ImagePart[] = [],
  toolOptions?: TwinToolOptions,
  onTrace?: (step: TwinTraceStep) => void,
  responseFormat?: StructuredOutputFormat,
) {
  let text = "";
  let complete = false;
  let usage: Usage = { input: 0, output: 0, cached: 0 };
  let observed = false;
  let requested = false;
  let route = { provider: target.providerId, model: target.model };
  const receipts = new Set<string>();
  const charges: Array<Usage & { costUsd?: number }> = [];
  let missingRequests = 0;
  const recordResponse = (response: ProviderResponse): void => {
    const id = response.attemptId ?? response.requestId ?? "unidentified";
    if (receipts.has(id)) return;
    if (!receipts.size) requested = false;
    receipts.add(id);
    requested ||= response.requested !== false;
    if (response.usage === "missing" && response.requested !== false) missingRequests++;
  };
  const measured = (): TwinSnapshot["training"]["usage"] => {
    const missing = missingRequests || Number(!receipts.size && requested && !observed);
    const priced = observed && !missing && charges.every((charge) => charge.costUsd !== undefined);
    return {
      ...usage,
      ...(priced
        ? { costUsd: charges.reduce((total, charge) => total + (charge.costUsd ?? 0), 0) }
        : {}),
      ...(receipts.size ? { charges, missingRequests: missing } : {}),
      ...(!requested && !observed ? { requested: false } : {}),
    };
  };
  const toolkit = buildTwinTools(toolOptions);
  const maxTurns = toolOptions ? (toolOptions.maxToolTurns ?? 8) : 1;
  const history: Message[] = [
    { role: "user", content: data, ...(images.length ? { images } : {}) },
  ];
  let useResponseFormat = responseFormat !== undefined;
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      signal.throwIfAborted();
      requested = true;
      text = "";
      let reasoning = "";
      let reasoningNoted = false;
      complete = false;
      const toolCalls: ToolCall[] = [];
      const allowTools = toolkit.specs.length > 0 && turn + 1 < maxTurns;
      const runStream = async () => {
        for await (const event of target.provider.stream(
          {
            model: target.model,
            system,
            messages: history,
            tools: allowTools ? toolkit.specs : [],
            ...(allowTools ? { toolChoice: "auto" as const } : {}),
            ...(useResponseFormat && responseFormat ? { responseFormat } : {}),
            maxTokens: 4096,
            ...(target.reasoning ? { reasoning: target.reasoning } : {}),
            ...(target.variant ? { variant: target.variant } : {}),
          },
          signal,
        )) {
          if (event.type === "text") {
            text += event.delta;
            if (text.length > 48_000) throw new Error("Twin response exceeded the output boundary");
          }
          if (event.type === "reasoning") {
            reasoning += event.delta;
            if (!reasoningNoted && reasoning.trim().length > 0) {
              reasoningNoted = true;
              onTrace?.({
                id: `reasoning-${turn}`,
                kind: "reasoning",
                label: "Analyzing reactions and patterns",
                status: "running",
              });
            }
          }
          if (event.type === "usage") {
            observed = true;
            usage = addUsage(usage, event);
            const provider = event.provider ?? route.provider;
            const model = event.model ?? route.model;
            const price =
              target.priceFor?.(provider, model) ??
              (provider === target.providerId && model === target.model ? target.price : undefined);
            const costUsd = price?.(event);
            charges.push({ ...event, ...(costUsd === undefined ? {} : { costUsd }) });
          }
          if (event.type === "route") route = { provider: event.provider, model: event.model };
          if (event.type === "response") recordResponse(event.response);
          if (event.type === "done" && event.response) recordResponse(event.response);
          signal.throwIfAborted();
          if (event.type === "tool_call") {
            if (!allowTools) throw new Error("Twin extraction cannot execute tools");
            toolCalls.push({
              id: event.id,
              name: event.name,
              args: event.args,
              ...(event.extraContent === undefined ? {} : { extraContent: event.extraContent }),
            });
          }
          if (event.type === "done") {
            complete = event.reason === "end" || (allowTools && event.reason === "tool_use");
          }
        }
      };
      try {
        await runStream();
      } catch (streamError) {
        if (
          useResponseFormat &&
          streamError instanceof TransportError &&
          (streamError.status === 400 || streamError.status === 422)
        ) {
          useResponseFormat = false;
          text = "";
          reasoning = "";
          complete = false;
          toolCalls.length = 0;
          await runStream();
        } else {
          throw streamError;
        }
      }
      if (reasoningNoted) {
        onTrace?.({
          id: `reasoning-${turn}`,
          kind: "reasoning",
          label: "Analyzing reactions and patterns",
          detail: reasoning.trim().slice(0, 180),
          status: "done",
        });
      }
      signal.throwIfAborted();
      if (toolCalls.length > 0 && allowTools) {
        history.push({ role: "assistant", content: text, reasoning, toolCalls });
        for (const call of toolCalls) {
          const detail = traceDetail(call.name, call.args);
          onTrace?.({
            id: call.id,
            kind: "tool",
            label: call.name,
            ...(detail
              ? { detail: safeMemoryText(detail, toolOptions?.secrets ?? []).slice(0, 300) }
              : {}),
            status: "running",
          });
          const result = await toolkit.run(call, signal);
          onTrace?.({
            id: call.id,
            kind: "tool",
            label: call.name,
            ...(detail
              ? { detail: safeMemoryText(detail, toolOptions?.secrets ?? []).slice(0, 300) }
              : {}),
            status: result.ok ? "done" : "error",
          });
          history.push(toolMessage(call, result));
        }
        continue;
      }
      if (!complete) throw new Error("Twin response was incomplete. No candidates were saved.");
      return { value: twinResponse(text), usage: measured() };
    }
    throw new Error("Twin response was incomplete. No candidates were saved.");
  } catch (error) {
    const response = responseOfError(error);
    if (response && !receipts.size) recordResponse(response);
    throw new TwinInferenceError(error, measured(), target.providerId, target.model);
  }
}

export function checked<T>(
  target: InferenceTarget,
  usage: TwinSnapshot["training"]["usage"],
  validate: () => T,
): T {
  try {
    return validate();
  } catch (error) {
    throw new TwinInferenceError(error, usage, target.providerId, target.model);
  }
}

export async function delegate(
  target: InferenceTarget,
  input: TwinDelegateInput,
  entries: TwinSnapshot["entries"],
  signal: AbortSignal,
  toolOptions?: TwinToolOptions,
) {
  const { images: offered = [], ...delegation } = input;
  const images = !target.modalities?.length || target.modalities.includes("image") ? offered : [];
  const selected: TwinSnapshot["entries"] = [];
  let profileCharacters = 0;
  for (const entry of [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const size =
      entry.summary.length +
      entry.content.length +
      entry.voice.length +
      entry.appliesWhen.length +
      256;
    if (profileCharacters + size > 18_000) continue;
    selected.push(entry);
    profileCharacters += size;
  }
  const profile = selected.map(
    ({ id, reaction, strength, voice, summary, content, appliesWhen }) => ({
      id,
      reaction,
      strength,
      voice,
      summary,
      content,
      appliesWhen,
    }),
  );
  const result = await infer(
    target,
    delegatePrompt,
    [
      markdownData(
        "Current delegation",
        [],
        JSON.stringify({
          ...delegation,
          userMessages: recentMessages(input.userMessages, 10_000),
          task: input.task.slice(0, 12_000),
          directive: input.directive.slice(0, 4000),
          evidence: recentMessages(input.evidence, 12_000),
          ...(input.result === undefined ? {} : { result: input.result.slice(0, 10_000) }),
        }),
      ),
      markdownData("Learned persona", [], JSON.stringify(profile)),
      markdownData(
        "Visual evidence",
        [],
        images.length
          ? `${images.length} actual tool image artifacts are attached. Inspect their pixels as evidence of the submitted work.`
          : offered.length
            ? "The selected model does not accept images. Their pixels were not inspected; do not claim visual acceptance."
            : "No image artifacts were supplied. Do not claim to have inspected pixels.",
      ),
    ].join("\n\n"),
    signal,
    images.map((image) => ({
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    })),
    toolOptions ?? (target.cwd ? { cwd: target.cwd } : undefined),
    undefined,
    TWIN_DECISION_FORMAT,
  );
  return checked(target, result.usage, () => {
    const decision = TwinDecisionSchema.parse({
      ...z.record(z.string(), z.unknown()).parse(result.value),
      provider: target.providerId,
      model: target.model,
      usage: result.usage,
    });
    if (decision.entryIds.some((id) => !selected.some((entry) => entry.id === id)))
      throw new Error("Twin decision cites an unknown persona trait");
    return decision;
  });
}

function recentMessages(messages: readonly string[], limit: number): string[] {
  const selected: string[] = [];
  let room = limit;
  for (const message of [...messages].reverse()) {
    if (room <= 0) break;
    selected.unshift(message.slice(-room));
    room -= selected[0]?.length ?? 0;
  }
  return selected;
}
