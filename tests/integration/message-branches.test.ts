import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageEditOptions } from "../../src/app/message-branches";
import { createHandlers } from "../../src/app/server-handlers";
import type { AppService } from "../../src/app/service";
import { createAppService } from "../../src/app/service";
import type { Event, ReasoningEffort, RunResult } from "../../src/core/types";
import { sessionPaths } from "../../src/store/paths";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

interface RequestBody {
  model: string;
  reasoning_effort?: string;
  messages: Array<{ role: string; content: unknown }>;
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-message-branches-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const requests: RequestBody[] = [];
  let held:
    | {
        entered: ReturnType<typeof Promise.withResolvers<void>>;
        release: ReturnType<typeof Promise.withResolvers<void>>;
      }
    | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push((await request.json()) as RequestBody);
      const index = requests.length;
      const gate = held;
      held = undefined;
      gate?.entered.resolve();
      if (gate) await gate.release.promise;
      const response = {
        choices: [{ delta: { content: `branch-reply-${index}` }, finish_reason: "stop" }],
      };
      return new Response(`data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  cleanup.push(async () => server.stop(true));
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      conversation: { enabled: false },
      provider: "test",
      model: "branches",
      catalog: { autoRefresh: false },
      skills: { sources: [] },
      checkpoints: { shell: false },
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: {
            branches: { context: 128_000, output: 1024, modalities: { input: ["text", "image"] } },
            alternate: {
              context: 128_000,
              output: 1024,
              modalities: { input: ["text", "image"] },
              reasoning: true,
              reasoningMode: "effort",
              reasoningLevels: ["low", "high"],
            },
          },
        },
      },
    }),
  );
  return {
    cwd,
    requests,
    holdNext() {
      const gate = {
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      held = gate;
      cleanup.push(async () => gate.release.resolve());
      return gate;
    },
  };
}

function prompts(events: Event[]): string[] {
  return events.flatMap((event) =>
    event.type === "session.started" && !event.internal && !event.resumed
      ? [event.prompt]
      : event.type === "steer.applied"
        ? [event.text]
        : [],
  );
}

async function run(app: AppService, prompt: string, sessionId?: string) {
  const result = (await app.session.send({
    type: "run",
    prompt,
    ...(sessionId ? { sessionId } : {}),
  })) as RunResult;
  expect(result.stopReason).toBe("end");
  await app.session.flush();
  return result.sessionId;
}

async function edit(
  app: AppService,
  id: string,
  messageId: string,
  text: string,
  input: MessageEditOptions = {},
  reasoning?: ReasoningEffort,
) {
  const done = Promise.withResolvers<void>();
  const unsubscribe = app.session.subscribe((event) => {
    if (event.sessionId === id && event.type === "session.finished") {
      if (event.result.stopReason === "end") done.resolve();
      else done.reject(new Error(`Replacement run stopped: ${event.result.stopReason}`));
    }
  });
  try {
    await createHandlers(app, () => {})["sessions.edit"]({
      type: "sessions.edit",
      id,
      messageId,
      text,
      ...input,
      ...(reasoning ? { reasoning } : {}),
    });
    await done.promise;
    await app.session.flush();
    return app.readMessageHistory(id);
  } finally {
    unsubscribe();
  }
}

describe("message branch history", () => {
  test("editing any user message preserves the prefix and separate continuations across selections and restart", async () => {
    const f = await fixture();
    let app = await createAppService(f.cwd);
    cleanup.push(() => app.dispose());
    const prefix = "prefix-kept  exact\n";
    const id = await run(app, prefix);
    await run(app, "middle-original", id);
    await run(app, "suffix-original", id);
    const initial = await app.readMessageHistory(id);
    const middle = initial.messageVersions[1];
    if (!middle) throw new Error("The middle message has no identity");
    const original = middle.variants[0];
    if (!original) throw new Error("The original message version is missing");
    expect(prompts(initial.events)).toEqual([prefix, "middle-original", "suffix-original"]);

    const edited = await edit(app, id, middle.messageId, "middle-revised  \n");
    expect(prompts(edited.events)).toEqual([prefix, "middle-revised  \n"]);
    expect(
      edited.events.slice(
        0,
        initial.events.findIndex(
          (event) => event.type === "session.started" && event.prompt === "middle-original",
        ),
      ),
    ).toEqual(
      initial.events.slice(
        0,
        initial.events.findIndex(
          (event) => event.type === "session.started" && event.prompt === "middle-original",
        ),
      ),
    );
    const request = JSON.stringify(f.requests.at(-1));
    expect(request).toContain(prefix.trim());
    expect(request).toContain("branch-reply-1");
    expect(request).toContain("middle-revised");
    for (const hidden of ["middle-original", "suffix-original", "branch-reply-2", "branch-reply-3"])
      expect(request).not.toContain(hidden);
    const revisedVersion = edited.messageVersions[1];
    expect(revisedVersion?.current).toBe(2);
    expect(revisedVersion?.variants).toHaveLength(2);
    const revised = revisedVersion?.variants[1];
    if (!revised) throw new Error("The revised message version is missing");
    await run(app, "suffix-revised", id);

    const restored = await app.selectMessageBranch(id, middle.messageId, original);
    expect(prompts(restored.events)).toEqual([prefix, "middle-original", "suffix-original"]);
    expect(restored.messageVersions[1]?.current).toBe(1);
    await run(app, "original-continued", id);
    const resumed = await app.selectMessageBranch(id, middle.messageId, revised);
    expect(prompts(resumed.events)).toEqual([prefix, "middle-revised  \n", "suffix-revised"]);
    expect(resumed.messageVersions[1]?.current).toBe(2);

    const suffix = resumed.messageVersions[2];
    if (!suffix) throw new Error("The revised suffix has no identity");
    const nested = await edit(app, id, suffix.messageId, "suffix-nested");
    expect(prompts(nested.events)).toEqual([prefix, "middle-revised  \n", "suffix-nested"]);
    expect(nested.messageVersions[2]?.variants).toHaveLength(2);
    await app.selectMessageBranch(id, middle.messageId, original);
    const repeated = await edit(app, id, middle.messageId, "middle-third");
    expect(prompts(repeated.events)).toEqual([prefix, "middle-third"]);
    expect(repeated.messageVersions[1]?.current).toBe(3);
    expect(repeated.messageVersions[1]?.variants).toHaveLength(3);

    const first = repeated.messageVersions[0];
    if (!first) throw new Error("The first message has no identity");
    const firstEdited = await edit(app, id, first.messageId, "prefix-revised");
    expect(prompts(firstEdited.events)).toEqual(["prefix-revised"]);
    expect(firstEdited.messageVersions[0]?.variants).toHaveLength(2);
    const third = repeated.messageVersions[1]?.variants[2];
    if (!third) throw new Error("The third middle version is missing");
    const firstOriginal = first.variants[0];
    if (!firstOriginal) throw new Error("The first original version is missing");
    await app.selectMessageBranch(id, first.messageId, firstOriginal);
    await app.selectMessageBranch(id, middle.messageId, third);
    await app.dispose();
    app = await createAppService(f.cwd);
    const reopened = await app.readMessageHistory(id);
    expect(prompts(reopened.events)).toEqual([prefix, "middle-third"]);
    expect(reopened.messageVersions[1]?.current).toBe(3);
    await run(app, "after-restart", id);
    const continued = JSON.stringify(f.requests.at(-1));
    expect(continued).toContain("middle-third");
    for (const hidden of [
      "middle-original",
      "suffix-original",
      "middle-revised",
      "suffix-revised",
      "prefix-revised",
    ])
      expect(continued).not.toContain(hidden);
    const journal = await readFile(sessionPaths(f.cwd, id).events, "utf8");
    for (const preserved of [
      "middle-original",
      "suffix-original",
      "middle-revised",
      "suffix-nested",
      "middle-third",
      "prefix-revised",
    ])
      expect(journal).toContain(preserved);
  }, 20_000);

  test("edits retain captured attachments and context, while busy history changes are rejected", async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, "image.png"), Buffer.from(PNG, "base64"));
    await writeFile(join(f.cwd, "notes.txt"), "attachment-original-content");
    const app = await createAppService(f.cwd);
    cleanup.push(() => app.dispose());
    const result = (await app.session.send({
      type: "run",
      prompt: "message-with-attachments",
      attachments: ["image.png", "notes.txt"],
      contexts: [
        {
          kind: "selection",
          source: "editor",
          label: "Saved selection",
          text: "context-original-content",
        },
      ],
    })) as RunResult;
    expect(result.stopReason).toBe("end");
    const id = result.sessionId;
    await app.session.flush();
    const before = await app.readMessageHistory(id);
    const version = before.messageVersions[0];
    if (!version) throw new Error("The attachment message has no identity");
    await rm(join(f.cwd, "image.png"));
    await writeFile(join(f.cwd, "notes.txt"), "attachment-replacement-content");
    const edited = await edit(app, id, version.messageId, "edited-with-attachments");
    const payload = JSON.stringify(f.requests.at(-1));
    expect(payload).toContain(`data:image/png;base64,${PNG}`);
    expect(payload).toContain("attachment-original-content");
    expect(payload).toContain("context-original-content");
    expect(payload).not.toContain("attachment-replacement-content");
    expect(payload).not.toContain("message-with-attachments");

    const original = edited.messageVersions[0]?.variants[0];
    if (!original) throw new Error("The original attachment message is missing");
    const gate = f.holdNext();
    const running = run(app, "held-work", id);
    await gate.entered.promise;
    try {
      await expect(app.editMessage(id, version.messageId, "cannot-edit-busy")).rejects.toThrow(
        "Finish or stop",
      );
      await expect(app.selectMessageBranch(id, version.messageId, original)).rejects.toThrow(
        "Finish or stop",
      );
      expect(prompts((await app.readMessageHistory(id)).events)).toEqual([
        "edited-with-attachments",
        "held-work",
      ]);
    } finally {
      gate.release.resolve();
      await running;
    }
    await expect(app.editMessage(id, "m_missing", "rejected-missing")).rejects.toThrow("no longer");
    await expect(app.selectMessageBranch(id, version.messageId, "v_missing")).rejects.toThrow(
      "Unknown message variant",
    );
    expect(prompts((await app.readMessageHistory(id)).events)).toEqual([
      "edited-with-attachments",
      "held-work",
    ]);
  }, 20_000);
  test("composer edits replace and remove attachments and context without changing text, using the selected model", async () => {
    const f = await fixture();
    const screenshot =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    await writeFile(join(f.cwd, "original.png"), Buffer.from(PNG, "base64"));
    await writeFile(join(f.cwd, "screenshot.png"), Buffer.from(screenshot, "base64"));
    await writeFile(join(f.cwd, "original.txt"), "old-attachment-data");
    await writeFile(join(f.cwd, "replacement.txt"), "new-attachment-data");
    const app = await createAppService(f.cwd);
    cleanup.push(() => app.dispose());
    const text = "same message  \n";
    const result = (await app.session.send({
      type: "run",
      prompt: text,
      attachments: ["original.png", "original.txt"],
      contexts: [
        {
          kind: "selection",
          source: "editor",
          label: "Original context",
          text: "old-context-data",
        },
      ],
    })) as RunResult;
    const id = result.sessionId;
    const before = await app.readMessageHistory(id);
    const original = before.messageVersions[0];
    if (!original) throw new Error("Missing original message");
    await app.setModel({ sessionId: id, provider: "test", model: "alternate", reasoning: "high" });
    const replacement = await edit(
      app,
      id,
      original.messageId,
      text,
      {
        attachments: ["screenshot.png", "replacement.txt"],
        contexts: [
          {
            kind: "selection",
            source: "editor",
            label: "Replacement context",
            text: "new-context-data",
          },
        ],
      },
      "low",
    );
    expect(prompts(replacement.events)).toEqual([text]);
    expect(replacement.messageVersions[0]?.current).toBe(2);
    const request = f.requests.at(-1);
    expect(request?.model).toBe("alternate");
    expect(request?.reasoning_effort).toBe("low");
    const payload = JSON.stringify(request);
    expect(payload).toContain(`data:image/png;base64,${screenshot}`);
    expect(payload).toContain("new-attachment-data");
    expect(payload).toContain("new-context-data");
    expect(payload).not.toContain(`data:image/png;base64,${PNG}`);
    expect(payload).not.toContain("old-attachment-data");
    expect(payload).not.toContain("old-context-data");
    const version = replacement.events.find((event) => event.type === "session.started");
    expect(version).toMatchObject({
      model: "alternate",
      reasoning: "low",
      attachments: [{ name: "screenshot.png" }],
    });

    const journalBeforeFailure = await readFile(sessionPaths(f.cwd, id).events, "utf8");
    const handlers = createHandlers(app, () => {});
    await expect(
      handlers["sessions.edit"]({
        type: "sessions.edit",
        id,
        messageId: original.messageId,
        text,
        attachments: ["missing.png"],
      }),
    ).rejects.toThrow("Cannot read attachment");
    await expect(
      handlers["sessions.edit"]({
        type: "sessions.edit",
        id,
        messageId: original.messageId,
        text,
        attachments: "invalid",
      }),
    ).rejects.toThrow();
    expect(await readFile(sessionPaths(f.cwd, id).events, "utf8")).toBe(journalBeforeFailure);

    const removed = await edit(app, id, original.messageId, text, {
      attachments: [],
      contexts: [],
    });
    expect(removed.messageVersions[0]?.current).toBe(3);
    expect(f.requests.at(-1)?.reasoning_effort).toBe("high");
    const emptyPayload = JSON.stringify(f.requests.at(-1));
    for (const data of [
      "data:image/png",
      "new-attachment-data",
      "old-attachment-data",
      "new-context-data",
      "old-context-data",
    ])
      expect(emptyPayload).not.toContain(data);
    expect(removed.events.find((event) => event.type === "session.started")).toMatchObject({
      attachmentSnapshot: { media: [], blocks: [] },
    });

    const added = await edit(app, id, original.messageId, text, {
      attachments: ["screenshot.png"],
      contexts: [],
    });
    expect(added.messageVersions[0]?.current).toBe(4);
    expect(JSON.stringify(f.requests.at(-1))).toContain(`data:image/png;base64,${screenshot}`);
    const oldVariant = original.variants[0];
    if (!oldVariant) throw new Error("Missing original variant");
    const restored = await app.selectMessageBranch(id, original.messageId, oldVariant);
    expect(restored.events.find((event) => event.type === "session.started")).toMatchObject({
      attachments: [{ name: "original.png" }],
      contexts: [{ text: "old-context-data" }],
    });
    const chips = restored.messageVersions[0]?.attachments ?? [];
    expect(chips.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: "original.png", kind: "image" },
      { name: "original.txt", kind: "text" },
      { name: "Original context", kind: "text" },
    ]);
    expect(chips.every(({ size }) => size > 0)).toBe(true);
    const beforeUnknown = await readFile(sessionPaths(f.cwd, id).events, "utf8");
    await expect(
      app.editMessage(id, original.messageId, text, undefined, {
        retainedAttachments: ["saved_unknown"],
      }),
    ).rejects.toThrow("Unknown saved attachment");
    expect(await readFile(sessionPaths(f.cwd, id).events, "utf8")).toBe(beforeUnknown);
    await rm(join(f.cwd, "original.txt"));
    const retained = await edit(app, id, original.messageId, text, {
      retainedAttachments: chips.filter(({ kind }) => kind === "text").map(({ id }) => id),
      attachments: ["screenshot.png"],
    });
    const mixedPayload = JSON.stringify(f.requests.at(-1));
    for (const data of ["old-attachment-data", "old-context-data", screenshot])
      expect(mixedPayload).toContain(data);
    expect(mixedPayload).not.toContain(`data:image/png;base64,${PNG}`);
    expect(retained.messageVersions[0]?.attachments?.map(({ name }) => name)).toEqual([
      "original.txt",
      "screenshot.png",
      "Original context",
    ]);
    const cleared = await edit(app, id, original.messageId, text, { retainedAttachments: [] });
    expect(cleared.messageVersions[0]?.attachments).toEqual([]);
    for (const data of ["old-attachment-data", "old-context-data", "data:image/png"])
      expect(JSON.stringify(f.requests.at(-1))).not.toContain(data);
  }, 20_000);
});
