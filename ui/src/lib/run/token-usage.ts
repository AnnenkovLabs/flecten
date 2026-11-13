import type { AgentEvent, AgentUsage } from "../types";

export interface ModelUsage extends AgentUsage {
  provider: string;
  model: string;
  role?: "Talker" | "Worker" | "Twin";
  cost: number | undefined;
}

export interface TokenUsageDetails {
  total: AgentUsage;
  models: ModelUsage[];
  lastTurnCost: number | undefined;
  runCost: number | undefined;
  completedCost: number | undefined;
  provider: string;
  model: string;
  pending?: { index: number; cost: number | undefined; turnCost: number | undefined } | undefined;
}

export function emptyTokenUsage(): TokenUsageDetails {
  return {
    total: { input: 0, output: 0, cached: 0 },
    models: [],
    lastTurnCost: 0,
    runCost: 0,
    completedCost: 0,
    provider: "",
    model: "",
  };
}

function sum(left: AgentUsage, right: AgentUsage): AgentUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cached: left.cached + right.cached,
    ...(left.reasoning === undefined && right.reasoning === undefined
      ? {}
      : { reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0) }),
    ...(left.cacheWrite === undefined && right.cacheWrite === undefined
      ? {}
      : { cacheWrite: (left.cacheWrite ?? 0) + (right.cacheWrite ?? 0) }),
  };
}

function addCost(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined || right === undefined ? undefined : left + right;
}

export function sessionUsageCost(details: TokenUsageDetails): number | undefined {
  return details.pending ? undefined : addCost(details.completedCost, details.runCost);
}

/** The same typed events build live totals and rebuild them from the task's durable log. */
export function tokenUsageEvent(state: TokenUsageDetails, event: AgentEvent): TokenUsageDetails {
  switch (event.type) {
    case "twin.activity": {
      const usage = event.activity.usage;
      if (!usage) return state;
      const { provider, model } = event.activity;
      const models = [...state.models];
      const index = models.findIndex(
        (entry) => entry.provider === provider && entry.model === model && entry.role === "Twin",
      );
      const previous = models[index] ?? {
        input: 0,
        output: 0,
        cached: 0,
        provider,
        model,
        role: "Twin" as const,
        cost: 0,
      };
      models[index < 0 ? models.length : index] = {
        ...previous,
        ...sum(previous, usage),
        cost: addCost(previous.cost, usage.costUsd),
      };
      return {
        ...state,
        total: sum(state.total, usage),
        models,
        completedCost: addCost(state.completedCost, usage.costUsd),
      };
    }
    case "session.started":
      return {
        ...state,
        provider: event.provider,
        model: event.model,
        completedCost: sessionUsageCost(state),
        runCost: 0,
        lastTurnCost: 0,
        pending: undefined,
      };
    case "model.fallback":
      return { ...state, provider: event.provider, model: event.model };
    case "turn.started":
      return { ...state, lastTurnCost: 0 };
    case "usage": {
      const provider = event.provider ?? state.provider;
      const model = event.model ?? state.model;
      let index = state.models.findIndex(
        (entry) => entry.provider === provider && entry.model === model && entry.role !== "Twin",
      );
      const models = [...state.models];
      const previous = models[index] ?? {
        input: 0,
        output: 0,
        cached: 0,
        provider,
        model,
        cost: 0,
      };
      if (index < 0) index = models.length;
      models[index] = { ...previous, ...sum(previous, event.usage), cost: undefined };
      return {
        ...state,
        total: sum(state.total, event.usage),
        models,
        lastTurnCost: undefined,
        pending: { index, cost: previous.cost, turnCost: state.lastTurnCost },
      };
    }
    case "budget": {
      const cost = event.budget.spent.costUsd;
      const delta =
        cost === undefined || state.runCost === undefined
          ? undefined
          : Math.max(0, cost - state.runCost);
      const models = [...state.models];
      const pending = state.pending;
      const entry = pending && models[pending.index];
      if (pending && entry)
        models[pending.index] = { ...entry, cost: addCost(pending.cost, delta) };
      return {
        ...state,
        models,
        runCost: cost,
        pending: undefined,
        lastTurnCost: pending ? addCost(pending.turnCost, delta) : state.lastTurnCost,
      };
    }
    default:
      return state;
  }
}

export function conversationUsage(
  talker: TokenUsageDetails,
  worker: TokenUsageDetails,
): TokenUsageDetails {
  if (!worker.models.length) return talker;
  return {
    ...talker,
    total: sum(talker.total, worker.total),
    models: [
      ...talker.models.map((entry) => ({ ...entry, role: entry.role ?? ("Talker" as const) })),
      ...worker.models.map((entry) => ({ ...entry, role: "Worker" as const })),
    ],
    completedCost: addCost(sessionUsageCost(talker), sessionUsageCost(worker)),
    runCost: 0,
  };
}

export function usageMoney(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
}
