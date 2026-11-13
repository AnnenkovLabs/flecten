import { describe, expect, test } from "bun:test";
import { modelsCount, windowTitle } from "../../ui/src/lib/format";
import { budgetMeters, budgetTone } from "../../ui/src/lib/run/budget";
import { budgetNotice, interruptedNotice, jobNotice } from "../../ui/src/lib/run/notices";
import { Reconnect } from "../../ui/src/lib/run/reconnect";
import {
  finishedLabel,
  finishedSessions,
  mergedSessions,
  startedSessions,
} from "../../ui/src/lib/run/sessions";
import { canContinue, errorReason, fallbackReason } from "../../ui/src/lib/run-errors";
import {
  activateIfNeeded,
  mergeModels,
  providerWithBaseUrl,
  testableProvider,
  uniqueProviderId,
} from "../../ui/src/lib/settings/provider-draft";
import type {
  AgentBudget,
  AgentJob,
  AgentRunResult,
  AgentSessionSummary,
  ProviderSettings,
} from "../../ui/src/lib/types";

function budget(patch: Partial<AgentBudget> = {}): AgentBudget {
  return {
    limits: { tokens: 200_000, costUsd: 2, wallClockMs: 1_800_000 },
    spent: { tokens: 50_000, costUsd: 0.5, wallClockMs: 90_000 },
    remaining: {},
    ...patch,
  };
}

function job(patch: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    command: "bun test",
    cwd: "/repo",
    status: "exited",
    pid: 10,
    startedAt: 0,
    finishedAt: 2500,
    durationMs: 2500,
    exitCode: 0,
    signal: null,
    timedOut: false,
    logBytes: 10,
    error: null,
    ...patch,
  };
}

function provider(baseUrl: string, models: string[] = []): ProviderSettings {
  return {
    protocol: "openai-chat",
    baseUrl,
    models: Object.fromEntries(models.map((id) => [id, { id, name: id }])),
  } as unknown as ProviderSettings;
}

describe("run budget meters", () => {
  test("shows only the limits that are set, in a fixed order", () => {
    const meters = budgetMeters(budget());
    expect(meters.map((meter) => meter.kind)).toEqual(["tokens", "cost", "wall_clock"]);
    expect(meters.map((meter) => meter.label)).toEqual([
      "50K из 200K ток.",
      "$0.50 из $2.00",
      "1.5 из 30 мин",
    ]);
    expect(meters[0]?.ratio).toBe(0.25);
    expect(budgetMeters(budget({ limits: { costUsd: 1 } })).map((meter) => meter.kind)).toEqual([
      "cost",
    ]);
  });

  test("clamps ratios and moves the tone from calm to warning to over", () => {
    const spent = { tokens: 500_000, costUsd: 0.1, wallClockMs: 0 };
    const meters = budgetMeters(budget({ spent }));
    expect(meters[0]?.ratio).toBe(1);
    expect(budgetTone(budget(), budgetMeters(budget()))).toBe("ok");
    expect(budgetTone(budget({ spent }), meters)).toBe("warn");
    expect(budgetTone(budget({ spent, exceeded: "tokens" }), meters)).toBe("over");
  });
});

describe("run notices", () => {
  test("a finished job says what happened and how long it took", () => {
    expect(jobNotice(job()).meta).toBe("готово · 2.5 с");
    expect(jobNotice(job()).tone).toBe("info");
    expect(jobNotice(job({ exitCode: 2 })).meta).toStartWith("код выхода 2");
    expect(jobNotice(job({ timedOut: true })).meta).toStartWith("превысила время");
    expect(jobNotice(job({ status: "stopped", exitCode: null })).meta).toStartWith("остановлено");
    expect(jobNotice(job({ status: "failed", error: "spawn ENOENT" })).tone).toBe("warn");
  });

  test("interrupted and budget stops offer to continue", () => {
    const result = { summary: "Лимит токенов: 200K" } as AgentRunResult;
    expect(interruptedNotice("ядро перезапущено", 0)).toMatchObject({
      action: "continue",
      at: "1970-01-01T00:00:00.000Z",
    });
    expect(budgetNotice(result)).toMatchObject({ action: "continue", meta: "Лимит токенов: 200K" });
  });
});

describe("core reconnect", () => {
  test("backs off five times, then gives up until the core answers", () => {
    const reconnect = new Reconnect();
    try {
      expect(reconnect.ready()).toBe(false);
      for (let attempt = 0; attempt < 5; attempt += 1)
        expect(reconnect.schedule(() => {})).toBe(true);
      expect(reconnect.pending).toBe(true);
      expect(reconnect.schedule(() => {})).toBe(false);
      expect(reconnect.pending).toBe(false);
      reconnect.schedule(() => {});
      expect(reconnect.pending).toBe(false);
    } finally {
      reconnect.dispose();
    }
  });

  test("a project held by another window stops restarts until a core answers", () => {
    const reconnect = new Reconnect();
    let restarts = 0;
    try {
      reconnect.schedule(() => {
        restarts += 1;
      });
      reconnect.hold();
      expect(reconnect.held).toBe(true);
      expect(reconnect.pending).toBe(false);
      expect(reconnect.ready()).toBe(false);
      expect(reconnect.held).toBe(false);
      expect(restarts).toBe(0);
    } finally {
      reconnect.dispose();
    }
  });

  test("a restart that answered resets the attempts", () => {
    const reconnect = new Reconnect();
    try {
      reconnect.schedule(() => {});
      expect(reconnect.ready()).toBe(true);
      expect(reconnect.ready()).toBe(false);
      for (let attempt = 0; attempt < 5; attempt += 1)
        expect(reconnect.schedule(() => {})).toBe(true);
    } finally {
      reconnect.dispose();
    }
  });
});

describe("error cards", () => {
  const card = (code: string) => ({ kind: "error" as const, id: "e1", text: "", code });

  test("a locked project says which window to close and offers no continue", () => {
    expect(errorReason(card("project_locked"))).toContain("открыт в другом окне");
    expect(canContinue(card("project_locked"))).toBe(false);
    expect(canContinue(card("provider_failed"))).toBe(true);
  });

  test("a fallback answer says why the configured model was skipped", () => {
    expect(fallbackReason("rate_limit")).toBe("основная модель достигла лимита запросов");
    expect(fallbackReason("circuit_open")).toContain("недавно работала со сбоями");
    expect(fallbackReason("something_new")).toBe("основная модель не ответила");
  });

  test("an unknown code points to the details below", () => {
    expect(errorReason(card("something_new"))).toBe(
      "Задача остановилась из-за ошибки. Причина указана ниже.",
    );
  });
});

describe("task list", () => {
  const old: AgentSessionSummary = {
    id: "a",
    title: "Старая",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stopReason: "done",
  };

  test("a started run moves to the top without its old stop reason", () => {
    const list = startedSessions([old, { ...old, id: "b", title: "B" }], "a", "x");
    expect(list.map((session) => session.id)).toEqual(["a", "b"]);
    expect(list[0]?.title).toBe("Старая");
    expect(list[0]?.stopReason).toBeUndefined();
    expect(startedSessions([], "new", "Почини тесты\nподробности")[0]?.title).toBe("Почини тесты");
  });

  test("a finished run keeps its place and gets the stop reason", () => {
    const list = finishedSessions([{ ...old, id: "b" }, old], "a", "budget");
    expect(list.map((session) => session.id)).toEqual(["b", "a"]);
    expect(list[1]?.stopReason).toBe("budget");
    expect(finishedLabel("budget")).toBe("остановлено: исчерпан бюджет");
  });

  test("merging keeps local tasks the core does not list yet", () => {
    const local = { ...old, id: "local", updatedAt: "2026-02-01T00:00:00.000Z" };
    const merged = mergedSessions([old, local], [{ ...old, title: "С ядра" }]);
    expect(merged.map((session) => session.id)).toEqual(["local", "a"]);
    expect(merged[1]?.title).toBe("С ядра");
  });
});

describe("provider draft", () => {
  test("finds a provider by URL regardless of case and trailing slashes", () => {
    const draft = {
      provider: "x",
      model: "m",
      providers: { local: provider("http://LOCALHOST:1234/v1//") },
    };
    expect(providerWithBaseUrl(draft, "http://localhost:1234/v1")).toBe("local");
    expect(providerWithBaseUrl(draft, "http://localhost:1234/v2")).toBeUndefined();
  });

  test("activates a new provider only when the current choice points at nothing", () => {
    const draft = {
      provider: "gone",
      model: "m",
      providers: { a: provider("https://a", ["a1"]), b: provider("https://b", ["b1"]) },
    };
    activateIfNeeded(draft, "a");
    expect([draft.provider, draft.model]).toEqual(["a", "a1"]);
    activateIfNeeded(draft, "b");
    expect([draft.provider, draft.model]).toEqual(["a", "a1"]);
  });

  test("ids stay unique and counts read naturally", () => {
    const draft = { provider: "", model: "", providers: { openrouter: provider("https://o") } };
    expect(uniqueProviderId(draft, "OpenRouter")).toBe("openrouter-2");
    const target = provider("https://o", ["m1"]);
    expect(mergeModels(target, { m2: { id: "m2" } as never }, "o")).toBe("Обновлён o: 2 модели");
    expect(modelsCount(1)).toBe("1 модель");
    expect(modelsCount(11)).toBe("11 моделей");
    expect(modelsCount(21)).toBe("21 модель");
    expect(modelsCount(12_123)).toBe(`${(12_123).toLocaleString("ru-RU")} модели`);
    expect(modelsCount(12_125)).toBe(`${(12_125).toLocaleString("ru-RU")} моделей`);
  });

  test("the OS title names the open task", () => {
    expect(windowTitle("  Почини тесты ")).toBe("Почини тесты · Flecten");
    expect(windowTitle("")).toBe("Flecten");
  });

  test("the connection test gets no empty optional fields", () => {
    const tested = testableProvider({
      ...provider("https://a"),
      apiKey: "",
      apiKeyEnv: "",
      promptCacheKey: "",
    });
    expect(Object.keys(tested)).not.toContain("apiKey");
    expect(Object.keys(tested)).not.toContain("apiKeyEnv");
    expect(Object.keys(tested)).not.toContain("promptCacheKey");
  });
});
