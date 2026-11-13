import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectMemory, readOnlyMemory } from "../../src/app/memory";
import type { MemoryEvidence, MemoryWrite } from "../../src/core/memory/types";
import { MemoryStore } from "../../src/store/memory";

const workspaces: string[] = [];
async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-memory-store-"));
  workspaces.push(cwd);
  return cwd;
}

function evidence(): MemoryEvidence {
  const quote = "Keep the answer brief unless I ask for details.";
  return {
    sessionId: "session-1",
    role: "user",
    reference: "message-1",
    quote,
    digest: createHash("sha256").update(quote).digest("hex"),
  };
}

function draft(key = "user/answers", changes: Partial<MemoryWrite> = {}): MemoryWrite {
  return {
    key,
    kind: "preference",
    summary: "Keep answers brief",
    content: "Default to a brief answer; expand when the user requests details.",
    reason: "This user correction is absent from project instructions and future conversations.",
    cues: ["final answer", "explanation"],
    priority: "normal",
    sources: [evidence()],
    ...changes,
  };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

describe("durable agent memory", () => {
  test("publishes private records, preserves revision history and makes identical retries a no-op", async () => {
    const cwd = await workspace();
    const store = new MemoryStore({ cwd });
    const first = await store.put(draft());
    expect(first.revision).toBe(1);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    const original = await readFile(store.path, "utf8");
    expect(await store.put(draft())).toEqual(first);
    expect(await readFile(store.path, "utf8")).toBe(original);

    const update = draft(undefined, {
      content: "Answer in one paragraph by default.",
      expectedRevision: 1,
    });
    const second = await store.put(update);
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.revision).toBe(2);
    expect(await store.put(update)).toEqual(second);
    await expect(store.put(draft())).rejects.toThrow("revision conflict");
    await expect(
      store.put({ ...update, expectedRevision: 0, content: "Stale conflicting answer" }),
    ).rejects.toThrow("revision conflict");

    const disk = JSON.parse(await readFile(store.path, "utf8"));
    expect(disk.history).toEqual([first]);
    expect(await new MemoryStore({ cwd }).load()).toEqual([second]);
    const returnedSource = second.sources[0];
    if (!returnedSource) throw new Error("Missing fixture evidence");
    returnedSource.quote = "caller changed a copy";
    expect((await store.list())[0]?.sources[0]?.quote).not.toBe("caller changed a copy");
  });

  test("serializes canonical file aliases and detects simultaneous stale updates across store instances", async () => {
    const cwd = await workspace();
    const alias = join(await workspace(), "alias");
    await symlink(cwd, alias, "dir");
    const first = new MemoryStore({ cwd });
    const second = new MemoryStore({ cwd: alias });
    expect(first.path).toBe(second.path);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? first : second).put(draft(`project/item-${index}`)),
      ),
    );
    expect(await first.list()).toHaveLength(12);
    const [left, right] = await Promise.allSettled([
      first.put(draft("project/item-0", { expectedRevision: 1, content: "Update A" })),
      second.put(draft("project/item-0", { expectedRevision: 1, content: "Update B" })),
    ]);
    expect([left, right].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect([left, right].filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await second.list()).find((record) => record.key === "project/item-0")?.revision).toBe(
      2,
    );
  });

  test("rejects capacity without eviction and keeps forgotten tombstones available for invalidation", async () => {
    const store = new MemoryStore({ cwd: await workspace(), maxRecords: 1 });
    const first = await store.put(draft());
    await expect(store.put(draft("project/second"))).rejects.toThrow("capacity");
    expect(await store.list()).toEqual([first]);
    await expect(store.forget(first.id, 2)).rejects.toThrow("revision conflict");
    const forgotten = await store.forget(first.id, 1);
    expect(forgotten.status).toBe("forgotten");
    expect(forgotten.revision).toBe(2);
    expect(await store.forget(first.id, 1)).toEqual(forgotten);
    await expect(store.put(draft())).rejects.toThrow("revision conflict");
    const second = await store.put(draft("project/second"));
    expect(await store.list()).toEqual([forgotten, second]);
    expect(JSON.parse(await readFile(store.path, "utf8")).history).toEqual([first]);
  });

  test("fails closed on corrupt or malformed files and never replaces the original with an empty store", async () => {
    const store = new MemoryStore({ cwd: await workspace() });
    await mkdir(join(store.cwd, ".liquid"));
    for (const raw of [
      "{ broken json",
      JSON.stringify({ version: 2, records: [], history: [], unexpected: true }),
    ]) {
      await writeFile(store.path, raw);
      await expect(store.list()).rejects.toThrow("preserved");
      await expect(store.put(draft())).rejects.toThrow("preserved");
      expect(await readFile(store.path, "utf8")).toBe(raw);
    }
  });

  test("a failed atomic publication leaves no phantom record in memory", async () => {
    const store = new MemoryStore({ cwd: await workspace(), file: "a".repeat(240) });
    await expect(store.put(draft())).rejects.toThrow();
    expect(await store.list()).toEqual([]);
    expect(await Bun.file(store.path).exists()).toBe(false);
  });

  test("redacts known secrets and refuses malformed evidence before anything reaches disk", async () => {
    const credential = "credential-that-must-not-be-saved";
    const store = new MemoryStore({ cwd: await workspace(), secrets: () => [credential] });
    const first = await store.put(
      draft(undefined, {
        content: `Do not keep this credential: ${credential}`,
      }),
    );
    expect(first.content).not.toContain(credential);
    expect(await readFile(store.path, "utf8")).not.toContain(credential);
    const original = await readFile(store.path, "utf8");
    await expect(store.put(draft("project/no-sources", { sources: [] }))).rejects.toThrow(
      "Invalid memory write",
    );
    const toolEvidence = [{ ...evidence(), role: "tool" as const }];
    await expect(
      store.put(draft("project/fake-preference", { sources: toolEvidence })),
    ).rejects.toThrow("Invalid memory write");
    await expect(
      store.put(draft("project/lesson", { kind: "lesson", sources: toolEvidence })),
    ).rejects.toThrow("Invalid memory write");
    await expect(
      store.put(draft("project/forged", { sources: [{ ...evidence(), digest: "not-a-digest" }] })),
    ).rejects.toThrow("Invalid memory write");
    await expect(
      store.put(draft("project/oversized", { content: "x".repeat(8_001) })),
    ).rejects.toThrow("Invalid memory write");
    expect(await readFile(store.path, "utf8")).toBe(original);
    const custom = await new MemoryStore({ cwd: await workspace() }).put(
      draft(undefined, { kind: "deployment-caveat", sources: toolEvidence }),
    );
    expect(custom.kind).toBe("deployment-caveat");
  });

  test("migrates strict legacy files without pretending old entries are verified user evidence", async () => {
    const store = new MemoryStore({ cwd: await workspace() });
    await mkdir(join(store.cwd, ".liquid"));
    const legacy = {
      version: 1,
      records: [
        {
          id: "mem_legacy",
          text: "Use Bun for tests",
          kind: "preference",
          source: { sessionId: "legacy-session", path: "old-source.md" },
          weight: 1,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          tags: ["tooling"],
        },
      ],
    };
    await writeFile(store.path, JSON.stringify(legacy));
    const [record] = await store.list();
    expect(record?.id).toBe("mem_legacy");
    expect(record?.kind).toBe("context");
    expect(record?.priority).toBe("normal");
    expect(record?.sources[0]?.role).toBe("legacy");
    expect(record?.cues).toContain("legacy-unverified");
    expect(record?.content).toBe("Use Bun for tests");
    expect(JSON.parse(await readFile(store.path, "utf8")).version).toBe(2);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    expect(await store.list()).toEqual(record ? [record] : []);

    const invalid = JSON.stringify({
      ...legacy,
      records: [...legacy.records, { id: "incomplete" }],
    });
    await writeFile(store.path, invalid);
    await expect(store.list()).rejects.toThrow("preserved");
    expect(await readFile(store.path, "utf8")).toBe(invalid);
  });

  test("reconciles a full store atomically and exact retry preserves bytes and revisions", async () => {
    const cwd = await workspace();
    const store = new MemoryStore({ cwd, maxRecords: 1 });
    const previous = await store.put(draft());
    const change = {
      save: [
        draft("design/visual-proof", {
          topics: ["design", "verification"],
          appliesWhen: "When changing the interaction model.",
        }),
      ],
      forget: [{ id: previous.id, expectedRevision: 1 }],
    };
    const result = await store.reconcile(change);
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0]).toMatchObject({
      revision: 1,
      topics: ["design", "verification"],
      appliesWhen: "When changing the interaction model.",
    });
    expect(result.forgotten[0]).toMatchObject({
      id: previous.id,
      revision: 2,
      status: "forgotten",
    });
    const bytes = await readFile(store.path, "utf8");
    expect(await store.reconcile(change)).toEqual(result);
    expect(await readFile(store.path, "utf8")).toBe(bytes);
    expect(await new MemoryStore({ cwd }).list()).toEqual([...result.forgotten, ...result.saved]);
    expect(JSON.parse(bytes).history).toEqual([previous]);
    const noMetadata = result.forgotten[0];
    expect(noMetadata).not.toHaveProperty("topics");
    expect(noMetadata).not.toHaveProperty("appliesWhen");
  });

  test("a stale or malformed item cannot partially commit a batch", async () => {
    const store = new MemoryStore({ cwd: await workspace() });
    const original = await store.put(draft());
    const bytes = await readFile(store.path, "utf8");
    const batches = [
      {
        save: [
          draft("project/new"),
          draft(undefined, { expectedRevision: 0, content: "Stale replacement" }),
        ],
        forget: [],
      },
      { save: [draft("project/new"), draft("project/bad", { sources: [] })], forget: [] },
      { save: [draft("project/new")], forget: [{ id: original.id, expectedRevision: 2 }] },
      { save: [draft("project/new")], forget: [{ id: "absent-record", expectedRevision: 1 }] },
    ];
    for (const batch of batches) {
      await expect(store.reconcile(batch)).rejects.toThrow();
      expect(await readFile(store.path, "utf8")).toBe(bytes);
      expect(await store.list()).toEqual([original]);
    }
    const committed = await store.reconcile({ save: [draft("project/new")], forget: [] });
    expect(committed.saved[0]?.revision).toBe(1);
    await expect(
      store.reconcile({
        save: [draft("project/new", { expectedRevision: 0, content: "Conflicting retry" })],
        forget: [],
      }),
    ).rejects.toThrow("revision conflict");
    expect(await store.list()).toHaveLength(2);
  });

  test("reconciliation refuses empty, oversized and repeated operations before publication", async () => {
    const store = new MemoryStore({ cwd: await workspace() });
    const original = await store.put(draft());
    const bytes = await readFile(store.path, "utf8");
    for (const batch of [
      { save: [], forget: [] },
      { save: Array.from({ length: 9 }, (_, index) => draft(`project/item-${index}`)), forget: [] },
      {
        save: [],
        forget: Array.from({ length: 9 }, (_, index) => ({
          id: `id-${index}`,
          expectedRevision: 1,
        })),
      },
      { save: [draft("project/repeated"), draft("project/repeated")], forget: [] },
      {
        save: [],
        forget: [
          { id: original.id, expectedRevision: 1 },
          { id: original.id, expectedRevision: 1 },
        ],
      },
      {
        save: [draft(undefined, { expectedRevision: 1 })],
        forget: [{ id: original.id, expectedRevision: 1 }],
      },
    ]) {
      await expect(store.reconcile(batch)).rejects.toThrow();
      expect(await readFile(store.path, "utf8")).toBe(bytes);
    }
  });

  test("a warm cache detects external replacement, corruption and deletion", async () => {
    const cwd = await workspace();
    const store = new MemoryStore({ cwd });
    const original = await store.put(draft());
    expect(await store.list()).toEqual([original]);
    const another = new MemoryStore({ cwd });
    const updated = await another.put(
      draft(undefined, { expectedRevision: 1, content: "Changed by another store" }),
    );
    expect(await store.list()).toEqual([updated]);
    await writeFile(store.path, "{ externally corrupted json");
    await expect(store.list()).rejects.toThrow("preserved");
    await expect(store.reconcile({ save: [draft("project/new")], forget: [] })).rejects.toThrow(
      "preserved",
    );
    expect(await readFile(store.path, "utf8")).toBe("{ externally corrupted json");
    await rm(store.path);
    expect(await store.list()).toEqual([]);
    expect((await store.put(draft())).revision).toBe(1);
  });

  test("failed publication never leaks a planned batch into the read cache", async () => {
    const store = new MemoryStore({ cwd: await workspace(), file: "b".repeat(240) });
    expect(await store.list()).toEqual([]);
    await expect(
      store.reconcile({ save: [draft("project/first"), draft("project/second")], forget: [] }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
    expect(await Bun.file(store.path).exists()).toBe(false);
  });

  test("project reconciliation refreshes diagnostics and child ports refuse every mutation", async () => {
    const project = projectMemory(await workspace(), () => []);
    const first = await project.port.put(draft());
    expect(project.count).toBe(1);
    await project.port.reconcile({
      save: [draft("project/second"), draft("project/third")],
      forget: [{ id: first.id, expectedRevision: 1 }],
    });
    expect(project.count).toBe(2);
    const child = readOnlyMemory(project.port);
    await expect(child.put(draft())).rejects.toThrow("read-only");
    await expect(child.forget(first.id, 2)).rejects.toThrow("read-only");
    await expect(child.reconcile({ save: [draft()], forget: [] })).rejects.toThrow("read-only");
    expect(await child.list()).toHaveLength(3);
    expect(project.count).toBe(2);
  });
});
