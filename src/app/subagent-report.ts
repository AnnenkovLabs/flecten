import { z } from "zod";
import reportPrompt from "../../prompts/subagents/report.md" with { type: "text" };
import { estimateMessages, estimateTokens, PROFILE_3 } from "../context";
import type { UsagePrice } from "../core/session/budget";
import { parseSubagentResult } from "../core/subagents/result";
import type { SubagentChildRequest, SubagentChildResult } from "../core/subagents/types";
import type { Message } from "../core/types";
import { addUsage, emptyUsage } from "../core/types/message";
import type { ModelProvider } from "../providers/types";

/** One schema-constrained formatting turn, with no workspace tools or work replay. */
export async function formatSubagentReport(input: {
  request: SubagentChildRequest;
  result: SubagentChildResult;
  provider: ModelProvider;
  model: string;
  history: readonly Message[];
  maxTokens: number;
  price: UsagePrice;
}): Promise<SubagentChildResult> {
  const { request, result } = input;
  const validation = parseSubagentResult(request.spec, result.text);
  if (result.error || validation.ok) return result;
  const remaining = request.budget.maxTokens - result.usage.input - result.usage.output;
  const schema = z.toJSONSchema(request.spec.resultSchema);
  const messages: Message[] = [...input.history, { role: "user", content: validation.error }];
  const inputTokens =
    estimateMessages(
      messages.map((message) =>
        message.role === "user" ? { role: "user", content: message.content } : message,
      ),
      PROFILE_3,
    ).tokens + estimateTokens(reportPrompt + JSON.stringify(schema), PROFILE_3).tokens;
  const outputTokens = remaining - inputTokens;
  if (
    request.signal.aborted ||
    (result.turns ?? 0) >= request.budget.maxTurns ||
    remaining <= 0 ||
    outputTokens < 1 ||
    (request.budget.maxCost !== undefined &&
      input.price({
        input: inputTokens,
        output: Math.min(input.maxTokens, outputTokens),
        cached: 0,
      }) !== undefined &&
      (result.usage.cost ?? 0) +
        (input.price({
          input: inputTokens,
          output: Math.min(input.maxTokens, outputTokens),
          cached: 0,
        }) ?? 0) >
        request.budget.maxCost) ||
    (request.budget.maxCost !== undefined &&
      result.usage.cost !== undefined &&
      result.usage.cost >= request.budget.maxCost)
  )
    return { ...result, error: `${validation.error} No budget remains to format the report.` };
  let usage = emptyUsage();
  let report: unknown;
  let count = 0;
  let ended = false;
  let error: string | undefined;
  try {
    for await (const event of input.provider.stream(
      {
        model: input.model,
        system: reportPrompt.trim(),
        messages,
        tools: [
          {
            name: "submit_report",
            description: "Submit the completed report without performing any additional work.",
            parameters: schema,
          },
        ],
        toolChoice: "required",
        maxTokens: Math.max(1, Math.min(input.maxTokens, outputTokens)),
      },
      request.signal,
    )) {
      if (event.type === "usage") usage = addUsage(usage, event);
      if (event.type === "tool_call") {
        count += 1;
        if (event.name === "submit_report") report = event.args;
      }
      if (event.type === "done") ended = event.reason !== "max_tokens";
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const cost = input.price(usage);
  const total = {
    ...addUsage(result.usage, usage),
    ...(cost === undefined || result.usage.cost === undefined
      ? {}
      : { cost: result.usage.cost + cost }),
  };
  request.onEvent?.({
    type: "usage",
    sessionId: "report",
    usage,
    model: input.model,
    provider: input.provider.id,
  });
  const text = count === 1 && ended && report !== undefined ? JSON.stringify(report) : result.text;
  const formatted = parseSubagentResult(request.spec, text);
  return {
    ...result,
    text,
    usage: total,
    turns: (result.turns ?? 0) + 1,
    ...(!error && formatted.ok
      ? {}
      : {
          error: `${validation.error} Report formatting failed: ${error ?? (formatted.ok ? "No accepted report was submitted." : formatted.error)}`,
        }),
  };
}
