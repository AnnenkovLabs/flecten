import { z } from "zod";
import consultPrompt from "../../prompts/twin-consult.md" with { type: "text" };
import delegatePrompt from "../../prompts/twin-delegate.md" with { type: "text" };
import learnPrompt from "../../prompts/twin-learn.md" with { type: "text" };
import {
  TwinAnswerSchema,
  type TwinCandidate,
  TwinCandidateSchema,
  TwinDecisionSchema,
  type TwinDelegateInput,
  TwinReactionSchema,
  type TwinSnapshot,
} from "../../shared/twin";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import type { ImagePart, Usage } from "../core/types";
import type { ModelProvider } from "../providers/types";
import { markdownData } from "../util/markdown";
import { TwinInferenceError } from "./inference-error";
import type { SourceMessage } from "./sources";

const proposed = TwinCandidateSchema.omit({ id: true, evidence: true }).extend({
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
const extraction = z.object({ candidates: z.array(proposed).max(12) }).strict();
export interface InferenceTarget {
  provider: ModelProvider;
  model: string;
  providerId: string;
  modalities?: readonly string[] | undefined;
  price(usage: Usage): number | undefined;
}

async function infer(
  target: InferenceTarget,
  system: string,
  data: string,
  signal: AbortSignal,
  images: ImagePart[] = [],
) {
  let text = "";
  let complete = false;
  let usage: Usage = { input: 0, output: 0, cached: 0 };
  let observed = false;
  try {
    for await (const event of target.provider.stream(
      {
        model: target.model,
        system,
        messages: [{ role: "user", content: data, ...(images.length ? { images } : {}) }],
        tools: [],
        toolChoice: "none",
        maxTokens: 4096,
      },
      signal,
    )) {
      if (event.type === "text") {
        text += event.delta;
        if (text.length > 48_000) throw new Error("Twin response exceeded the output boundary");
      }
      if (event.type === "usage") {
        observed = true;
        usage = {
          input: event.input,
          output: event.output,
          cached: event.cached,
          ...(event.reasoning ? { reasoning: event.reasoning } : {}),
        };
      }
      signal.throwIfAborted();
      if (event.type === "tool_call") throw new Error("Twin extraction cannot execute tools");
      if (event.type === "done") complete = event.reason === "end";
    }
    if (!complete) throw new Error("Twin response was incomplete. No candidates were saved.");
    const costUsd = observed ? target.price(usage) : undefined;
    return {
      value: JSON.parse(text) as unknown,
      usage: { ...usage, ...(costUsd === undefined ? {} : { costUsd }) },
    };
  } catch (error) {
    const costUsd = observed ? target.price(usage) : undefined;
    throw new TwinInferenceError(
      error,
      { ...usage, ...(costUsd === undefined ? {} : { costUsd }) },
      target.providerId,
      target.model,
    );
  }
}

function checked<T>(
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

export async function learn(
  target: InferenceTarget,
  messages: SourceMessage[],
  existing: TwinCandidate[],
  secrets: readonly string[],
  signal: AbortSignal,
) {
  const data = [
    markdownData(
      "Existing profile",
      [],
      JSON.stringify(existing.map(({ summary, appliesWhen }) => ({ summary, appliesWhen }))),
    ),
    ...messages.flatMap((message) => [
      ...(message.precedingAssistant
        ? [markdownData("Preceding assistant work, context only", [], message.precedingAssistant)]
        : []),
      markdownData("Untrusted user reaction", [["Source message ID", message.id]], message.text),
    ]),
  ].join("\n\n");
  const result = await infer(target, learnPrompt, data, signal);
  return checked(target, result.usage, () => {
    const parsed = extraction.parse(result.value);
    const candidates = parsed.candidates.map((candidate) => {
      const evidence = candidate.evidence.map((item) => {
        const source = messages.find((message) => message.id === item.sourceMessageId);
        if (!source?.text.includes(item.quote))
          throw new Error(
            "Twin returned a quote that does not occur in its named user source. No candidates were saved.",
          );
        return {
          sourceId: source.sourceId,
          sessionId: source.sessionId,
          reference: source.reference,
          digest: source.digest,
          quote: item.quote,
          ...(source.precedingAssistant ? { precedingAssistant: source.precedingAssistant } : {}),
        };
      });
      const id = memoryDigest(JSON.stringify({ ...candidate, evidence })).slice(0, 40);
      const entry = TwinCandidateSchema.parse({ ...candidate, id, evidence });
      if (safeMemoryText(JSON.stringify(entry), secrets) !== JSON.stringify(entry))
        throw new Error("Twin candidate contains a credential. No candidates were saved.");
      return entry;
    });
    return { candidates, usage: result.usage };
  });
}

export async function consult(
  target: InferenceTarget,
  question: string,
  entries: TwinSnapshot["entries"],
  signal: AbortSignal,
) {
  if (!entries.length)
    return TwinAnswerSchema.parse({
      answer: "No confirmed preferences answer this question yet.",
      abstained: true,
      entryIds: [],
      usage: { input: 0, output: 0, cached: 0 },
    });
  const selected = entries.slice(0, 32);
  const result = await infer(
    target,
    consultPrompt,
    [
      markdownData("Question", [], question),
      markdownData(
        "Confirmed profile",
        [],
        JSON.stringify(
          selected.map(({ id, summary, content, appliesWhen }) => ({
            id,
            summary,
            content,
            appliesWhen,
          })),
        ),
      ),
    ].join("\n\n"),
    signal,
  );
  return checked(target, result.usage, () => {
    const answer = TwinAnswerSchema.parse({
      ...z.record(z.string(), z.unknown()).parse(result.value),
      usage: result.usage,
    });
    if (
      answer.entryIds.some((id) => !selected.some((entry) => entry.id === id)) ||
      (!answer.abstained && !answer.entryIds.length)
    )
      throw new Error("Twin answer has unsupported citations");
    if (answer.abstained) answer.entryIds = [];
    return answer;
  });
}

export async function delegate(
  target: InferenceTarget,
  input: TwinDelegateInput,
  entries: TwinSnapshot["entries"],
  signal: AbortSignal,
) {
  const { images: offered = [], ...delegation } = input;
  const images = !target.modalities?.length || target.modalities.includes("image") ? offered : [];
  // ponytail: a bounded recent persona; add semantic retrieval when 64 active traits are insufficient.
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
