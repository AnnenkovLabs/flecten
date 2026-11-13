import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { PermissionEngine } from "../../src/security/permissions";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const bash = (id: string, command: string): ModelEvent[] => [
  { type: "tool_call", id, name: "bash", args: { command } },
  { type: "done", reason: "tool_use" },
];
const end: ModelEvent[] = [
  { type: "text", delta: "finished" },
  { type: "done", reason: "end" },
];

type Answer = "allow_once" | "deny" | "stop" | "none";

/** A session whose bash calls need approval; `answer` replies to every request. */
async function approvalRun(
  scripts: ModelEvent[][],
  answer: Answer,
  extra: Partial<SessionOptions> = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-approvals-"));
  dirs.push(cwd);
  const provider = scriptedProvider(scripts);
  const session = createSession({
    cwd,
    provider,
    providerId: "scripted",
    model: "scripted-1",
    tools: new ToolRegistry(builtinTools(), { limits }),
    system: "test",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 6, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
    permissions: new PermissionEngine({
      rules: [{ action: "shell", tool: "bash", policy: "ask" }],
    }),
    ...extra,
  });
  const events: Event[] = [];
  session.subscribe((event) => {
    events.push(event);
    if (event.type !== "approval.requested" || answer === "none") return;
    if (answer === "stop") void session.send({ type: "stop" });
    else void session.send({ type: "approval.respond", id: event.approval.id, decision: answer });
  });
  await session.send({ type: "run", prompt: "run commands" });
  const toolText = provider.requests
    .flatMap((request) => request.messages)
    .filter((message) => message.role === "tool")
    .map((message) => String(message.content));
  const resolved = events.flatMap((event) => (event.type === "approval.resolved" ? [event] : []));
  return { events, resolved, toolText: [...new Set(toolText)] };
}

describe("approvals", () => {
  test("allow once runs exactly that call; the next call asks again", async () => {
    const run = await approvalRun(
      [bash("call-1", "echo first-ok"), bash("call-2", "echo second-ok"), end],
      "allow_once",
    );
    expect(run.events.filter((event) => event.type === "approval.requested")).toHaveLength(2);
    expect(run.resolved.map((event) => [event.choice, event.by])).toEqual([
      ["allow_once", "user"],
      ["allow_once", "user"],
    ]);
    expect(run.toolText.some((text) => text.includes("first-ok"))).toBe(true);
    expect(run.toolText.some((text) => text.includes("second-ok"))).toBe(true);
  });

  test("a denied call returns an error to the model and the run goes on", async () => {
    const run = await approvalRun([bash("call-1", "echo never-run"), end], "deny");
    expect(run.resolved.map((event) => event.by)).toEqual(["user"]);
    expect(run.toolText).toHaveLength(1);
    expect(run.toolText[0]).toStartWith("Error:");
    expect(run.toolText[0]).not.toContain("never-run\n");
  });

  test("an unanswered approval is denied when it times out", async () => {
    const run = await approvalRun([bash("call-1", "echo late"), end], "none", {
      approvalTimeoutMs: 50,
    });
    expect(run.resolved.map((event) => [event.choice, event.by])).toEqual([["deny", "timeout"]]);
  });

  test("stopping the run releases a waiting approval", async () => {
    const run = await approvalRun([bash("call-1", "echo stopped"), end], "stop");
    expect(run.resolved.map((event) => [event.choice, event.by])).toEqual([["deny", "aborted"]]);
  });

  test("the request names the risk of a destructive command", async () => {
    const run = await approvalRun([bash("call-1", "git push --force origin main"), end], "deny");
    const requested = run.events.find((event) => event.type === "approval.requested");
    const risks = requested?.type === "approval.requested" ? requested.approval.risks : undefined;
    expect(risks?.map((risk) => risk.id)).toContain("git-push-force");
  });
});
