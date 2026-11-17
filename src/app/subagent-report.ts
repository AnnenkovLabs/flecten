import { z } from "zod";
import reportPrompt from "../../prompts/subagents/report.md" with { type: "text" };
import { estimateMessages, estimateTokens, PROFILE_3 } from "../context";
import type { UsagePrice } from "../core/session/budget";
import { parseSubagentResult } from "../core/subagents/result";
import type { SubagentChildRequest, SubagentChildResult } from "../core/subagents/types";
import type { Message } from "../core/types";
import { addUsage, emptyUsage } from "../core/types/message";
import { type ProviderResponse, responseOfError } from "../providers/response";
import type { ModelProvider } from "../providers/types";

/** One schema-constrained formatting turn, with no workspace tools or work replay. */
export async function formatSubagentReport(input: {
  request: SubagentChildRequest;
  result: SubagentChildResult;
  provider: ModelProvider;
  providerId?: string;
  model: string;
  history: readonly Message[];
  maxTokens: number;
  price: UsagePrice;
  priceFor?(provider: string, model: string): UsagePrice | undefined;
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
    request.taskBudget?.exhausted() ||
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
  let reported = false;
  let cost = 0;
  let priced = true;
  let missing = false;
  let route = { provider: input.providerId ?? input.provider.id, model: input.model };
  const receipts = new Set<string>();
  const unavailable = (provider: string, model: string): void => {
    missing = true;
    request.taskBudget?.unavailable();
    request.onEvent?.({ type: "usage.unavailable", sessionId: "report", provider, model });
  };
  const receipt = (response: ProviderResponse): void => {
    const key = response.attemptId ?? response.requestId ?? "unidentified";
    if (receipts.has(key)) return;
    receipts.add(key);
    request.onEvent?.({ type: "provider.response", sessionId: "report", response });
    if (response.usage === "missing" && response.requested !== false)
      unavailable(response.provider ?? route.provider, response.model ?? route.model);
  };
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
      if (event.type === "usage") {
        reported = true;
        usage = addUsage(usage, event);
        const provider = event.provider ?? route.provider;
        const model = event.model ?? route.model;
        const price =
          input.priceFor?.(provider, model) ??
          (provider === (input.providerId ?? input.provider.id) && model === input.model
            ? input.price
            : () => undefined);
        const charge = price(event);
        priced &&= charge !== undefined;
        cost += charge ?? 0;
        request.taskBudget?.add(event, price);
        request.onEvent?.({ type: "usage", sessionId: "report", usage: event, provider, model });
      }
      if (event.type === "tool_call") {
        count += 1;
        if (event.name === "submit_report") report = event.args;
      }
      if (event.type === "route") route = { provider: event.provider, model: event.model };
      if (event.type === "response") receipt(event.response);
      if (event.type === "done") {
        ended = event.reason !== "max_tokens";
        if (event.response) receipt(event.response);
      }
    }
  } catch (cause) {
    const response = responseOfError(cause);
    if (response && !receipts.size) receipt(response);
    error = cause instanceof Error ? cause.message : String(cause);
  }
  if (!reported && !receipts.size) unavailable(route.provider, route.model);
  const total = {
    ...addUsage(result.usage, usage),
    ...(!reported || !priced || missing || result.usage.cost === undefined
      ? {}
      : { cost: result.usage.cost + cost }),
  };
  if (request.taskBudget && (reported || missing))
    request.onEvent?.({
      type: "task.budget",
      sessionId: "report",
      budget: request.taskBudget.view(),
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
