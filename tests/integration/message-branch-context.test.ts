import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markInterrupted } from "../../src/app/recovery";
import { sessionPages } from "../../src/app/session-pages";
import { sessionModelHistory } from "../../src/app/session-replay";
import { SessionStorage } from "../../src/app/session-storage";
import { Services } from "../../src/core/services/registry";
import type { Event } from "../../src/core/types";
import type { SkillActivations } from "../../src/skills/tool";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";

test("branch replay restores skill restrictions and limits page reads to the selected continuation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-branch-context-"));
  const storage = new SessionStorage(
    cwd,
    () => [],
    () => new Services(() => []),
    async () => {},
  );
  const id = "branched-context";
  const append = (event: Event) => storage.persist(event);
  const start = (prompt: string): Event => ({
    type: "session.started",
    sessionId: id,
    provider: "test",
    model: "test",
    prompt,
  });
  const compact = (page: number, summary: string): Event => ({
    type: "context.compacted",
    sessionId: id,
    page,
    summary,
    kept: 0,
    pruned: 0,
  });
  try {
    const sink = pageSink(sessionPaths(cwd, id));
    await append(start("preserved"));
    await sink.write(1, "preserved page", "preserved transcript");
    await append(compact(1, "preserved summary"));
    await append(start("original target"));
    const target = (await storage.envelopes(id)).at(-1);
    if (!target) throw new Error("Missing target");
    await append({
      type: "tool.finished",
      sessionId: id,
      call: { id: "skill", name: "skill", args: {} },
      result: {
        ok: true,
        output: "hidden skill",
        data: {
          kind: "skill",
          name: "hidden",
          directory: cwd,
          resources: [],
          trust: "trusted",
          allowedTools: ["read"],
          reused: false,
        },
      },
    });
    await sink.write(2, "hidden page", "hidden transcript");
    await append(compact(2, "hidden summary"));
    const activations: SkillActivations = new Map();
    await sessionModelHistory(cwd, id, activations, storage);
    expect(activations.get(id)?.has("hidden")).toBe(true);
    await append({
      type: "history.edited",
      sessionId: id,
      branchId: "edited",
      parentBranchId: "original",
      messageId: `m_${target.seq}`,
      targetSequence: target.seq,
    });
    await append(start("revised target"));
    const scoped = sessionPages(cwd, storage, () => [])(id);
    expect(await scoped.count?.()).toBe(2);
    const archive = scoped.archive;
    if (!archive) throw new Error("Missing archive");
    expect((await archive.list()).data).toEqual({ kind: "context_pages", pages: [1] });
    expect((await archive.read({ page: 2 })).ok).toBe(false);
    expect((await archive.search({ query: "hidden" })).output).toContain("No archived matches");
    await scoped.write(3, "new page", "new transcript");
    expect((await archive.list()).data).toEqual({ kind: "context_pages", pages: [1, 3] });
    const history = await sessionModelHistory(cwd, id, activations, storage);
    expect(JSON.stringify(history)).not.toContain("hidden");
    expect(activations.get(id)?.has("hidden") ?? false).toBe(false);
    expect(JSON.stringify(history)).toContain("preserved summary");
    expect(JSON.stringify(history)).toContain("revised target");
  } finally {
    await storage.closeAll();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("recovery abandons an edit that crashed before recording its replacement message", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-branch-pending-"));
  const storage = new SessionStorage(
    cwd,
    () => [],
    () => new Services(() => []),
    async () => {},
  );
  const id = "pending-edit";
  try {
    await storage.persist({
      type: "session.started",
      sessionId: id,
      provider: "test",
      model: "test",
      prompt: "original survives",
    });
    const target = (await storage.envelopes(id)).at(-1);
    if (!target) throw new Error("Missing target");
    await storage.persist({
      type: "session.finished",
      sessionId: id,
      result: {
        sessionId: id,
        pass: true,
        stopReason: "end",
        summary: "done",
        turns: 1,
        usage: { input: 0, output: 0, cached: 0 },
      },
    });
    await storage.persist({
      type: "history.edited",
      sessionId: id,
      branchId: "incomplete",
      parentBranchId: "original",
      messageId: `m_${target.seq}`,
      targetSequence: target.seq,
    });
    await markInterrupted(cwd, (event) => storage.persist(event), storage);
    expect(
      (await storage.read(id)).find((event) => event.type === "session.started"),
    ).toMatchObject({ prompt: "original survives" });
    expect((await storage.envelopes(id)).at(-1)?.event).toMatchObject({
      type: "history.selected",
      branchId: "original",
    });
  } finally {
    await storage.closeAll();
    await rm(cwd, { recursive: true, force: true });
  }
});
