import learnPrompt from "../../prompts/twin-learn.md" with { type: "text" };
import {
  type TwinCandidate,
  TwinCandidateSchema,
  type TwinSnapshot,
  type TwinTraceStep,
} from "../../shared/twin";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import { markdownData } from "../util/markdown";
import {
  checked,
  delegate,
  extraction,
  type InferenceTarget,
  infer,
  TWIN_EXTRACTION_FORMAT,
  type TwinToolOptions,
} from "./inference-core";
import { TwinInferenceError } from "./inference-error";
import type { SourceMessage } from "./sources";

export { delegate, type InferenceTarget, type TwinToolOptions };

const LEARNING_BATCH_CHARS = 80_000;
const LEARNING_BATCH_MESSAGES = 120;

function normalizeWhitespace(value: string): string {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

function matchSourceQuote(
  batch: readonly SourceMessage[],
  sourceMessageId: string,
  quote: string,
): { source: SourceMessage; quote: string } | undefined {
  const byId = batch.find((message) => message.id === sourceMessageId);
  if (byId?.text.includes(quote)) return { source: byId, quote };
  const normQuote = normalizeWhitespace(quote);
  if (normQuote.length >= 4) {
    if (byId && normalizeWhitespace(byId.text).includes(normQuote)) {
      return { source: byId, quote: byId.text.slice(0, 4000) };
    }
    const fallback = batch.find(
      (message) =>
        message.text.includes(quote) || normalizeWhitespace(message.text).includes(normQuote),
    );
    if (fallback) {
      const exact = fallback.text.includes(quote) ? quote : fallback.text.slice(0, 4000);
      return { source: fallback, quote: exact };
    }
  }
  return undefined;
}

function chunkMessages(messages: readonly SourceMessage[]): SourceMessage[][] {
  if (messages.length <= LEARNING_BATCH_MESSAGES) {
    const totalChars = messages.reduce(
      (sum, msg) => sum + msg.text.length + (msg.precedingAssistant?.length ?? 0),
      0,
    );
    if (totalChars <= LEARNING_BATCH_CHARS) return [Array.from(messages)];
  }
  const batches: SourceMessage[][] = [];
  let current: SourceMessage[] = [];
  let chars = 0;
  for (const msg of messages) {
    const size = msg.text.length + (msg.precedingAssistant?.length ?? 0);
    if (
      current.length > 0 &&
      (current.length >= LEARNING_BATCH_MESSAGES || chars + size > LEARNING_BATCH_CHARS)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(msg);
    chars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function mergeUsage(
  left: TwinSnapshot["training"]["usage"],
  right: TwinSnapshot["training"]["usage"],
  isFirst = false,
): TwinSnapshot["training"]["usage"] {
  if (isFirst) return right;
  const charges = [...(left.charges ?? []), ...(right.charges ?? [])];
  const hasCost = left.costUsd !== undefined && right.costUsd !== undefined;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cached: left.cached + right.cached,
    ...(hasCost ? { costUsd: (left.costUsd ?? 0) + (right.costUsd ?? 0) } : {}),
    ...(charges.length ? { charges } : {}),
    ...((left.missingRequests ?? 0) + (right.missingRequests ?? 0) > 0
      ? { missingRequests: (left.missingRequests ?? 0) + (right.missingRequests ?? 0) }
      : {}),
  };
}

function buildLearnPayload(
  batch: readonly SourceMessage[],
  knownSummaries: readonly TwinCandidate[],
): string {
  const inlineMessages = batch.slice(0, 24);
  const catalogMessages = batch.slice(24);
  return [
    markdownData(
      "Existing profile",
      [],
      JSON.stringify(knownSummaries.map(({ summary, appliesWhen }) => ({ summary, appliesWhen }))),
    ),
    ...(catalogMessages.length > 0
      ? [
          markdownData(
            "Session message index (use inspect_messages, read, grep, or glob to inspect selectively)",
            [["Total indexed messages", String(batch.length)]],
            JSON.stringify(
              catalogMessages.map((m) => ({
                sourceMessageId: m.id,
                sourceId: m.sourceId,
                sessionId: m.sessionId,
                reference: m.reference,
                preview: m.text.slice(0, 180),
              })),
            ),
          ),
        ]
      : []),
    ...inlineMessages.flatMap((message) => [
      ...(message.precedingAssistant
        ? [markdownData("Preceding assistant work, context only", [], message.precedingAssistant)]
        : []),
      markdownData(
        "Untrusted user reaction",
        [
          ["Source message ID", message.id],
          ["Reference", message.reference],
        ],
        message.text,
      ),
    ]),
  ].join("\n\n");
}

export async function learn(
  target: InferenceTarget,
  messages: SourceMessage[],
  existing: TwinCandidate[],
  secrets: readonly string[],
  signal: AbortSignal,
  toolOptions?: TwinToolOptions,
  onTrace?: (step: TwinTraceStep) => void,
  onBatchCommitted?: (batch: {
    candidates: TwinCandidate[];
    processedDigests: string[];
    usage: TwinSnapshot["training"]["usage"];
    batchIndex: number;
    totalBatches: number;
  }) => Promise<void> | void,
) {
  const batches = chunkMessages(messages);
  let totalUsage: TwinSnapshot["training"]["usage"] = { input: 0, output: 0, cached: 0 };
  const allCandidates: TwinCandidate[] = [];
  const processedDigests: string[] = [];
  const knownSummaries = [...existing];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    signal.throwIfAborted();
    const batch = batches[batchIndex] ?? [];
    if (batches.length > 1)
      onTrace?.({
        id: `batch-${batchIndex}`,
        kind: "batch",
        label: `Batch ${batchIndex + 1} / ${batches.length}`,
        detail: `${batch.length} items`,
        status: "running",
      });
    const data = buildLearnPayload(batch, knownSummaries);
    let result: Awaited<ReturnType<typeof infer>>;
    try {
      result = await infer(
        target,
        learnPrompt,
        data,
        signal,
        [],
        toolOptions ? { ...toolOptions, messages: batch } : undefined,
        onTrace,
        TWIN_EXTRACTION_FORMAT,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof TwinInferenceError) {
        totalUsage = mergeUsage(totalUsage, error.usage, batchIndex === 0);
      }
      if (batches.length === 1) throw error;
      onTrace?.({
        id: `batch-${batchIndex}`,
        kind: "batch",
        label: `Batch ${batchIndex + 1} / ${batches.length}`,
        detail: error instanceof Error ? error.message.slice(0, 140) : "Skipped malformed batch",
        status: "error",
      });
      continue;
    }
    totalUsage = mergeUsage(totalUsage, result.usage, batchIndex === 0);
    let batchCandidates: TwinCandidate[] = [];
    try {
      batchCandidates = checked(target, totalUsage, () => {
        const parsed = extraction.parse(result.value);
        const accepted: TwinCandidate[] = [];
        for (const candidate of parsed.candidates) {
          const evidence = candidate.evidence.flatMap((item) => {
            const matched = matchSourceQuote(batch, item.sourceMessageId, item.quote);
            if (!matched) return [];
            return [
              {
                sourceId: matched.source.sourceId,
                sessionId: matched.source.sessionId,
                reference: matched.source.reference,
                digest: matched.source.digest,
                quote: matched.quote,
                ...(matched.source.precedingAssistant
                  ? { precedingAssistant: matched.source.precedingAssistant }
                  : {}),
              },
            ];
          });
          if (evidence.length === 0) {
            if (batches.length === 1 && parsed.candidates.length === 1) {
              throw new Error(
                "Twin returned a quote that does not occur in its named user source. No candidates were saved.",
              );
            }
            continue;
          }
          const id = memoryDigest(JSON.stringify({ ...candidate, evidence })).slice(0, 40);
          const entry = TwinCandidateSchema.parse({ ...candidate, id, evidence });
          if (safeMemoryText(JSON.stringify(entry), secrets) !== JSON.stringify(entry)) continue;
          accepted.push(entry);
        }
        return accepted;
      });
    } catch (error) {
      if (batches.length === 1) throw error;
      onTrace?.({
        id: `batch-${batchIndex}`,
        kind: "batch",
        label: `Batch ${batchIndex + 1} / ${batches.length}`,
        detail: error instanceof Error ? error.message.slice(0, 140) : "Skipped invalid batch",
        status: "error",
      });
      continue;
    }
    const batchDigests = batch.map((msg) => msg.digest);
    processedDigests.push(...batchDigests);
    for (const item of batchCandidates) {
      if (!allCandidates.some((c) => c.id === item.id)) {
        allCandidates.push(item);
        knownSummaries.push(item);
      }
    }
    await onBatchCommitted?.({
      candidates: batchCandidates,
      processedDigests: batchDigests,
      usage: totalUsage,
      batchIndex,
      totalBatches: batches.length,
    });
    if (batches.length > 1)
      onTrace?.({
        id: `batch-${batchIndex}`,
        kind: "batch",
        label: `Batch ${batchIndex + 1} / ${batches.length}`,
        detail: `${batch.length} items · +${batchCandidates.length}`,
        status: "done",
      });
  }
  return { candidates: allCandidates, processedDigests, usage: totalUsage };
}
