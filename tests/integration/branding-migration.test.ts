import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TwinSourceIdSchema } from "../../shared/twin";
import { lockProject } from "../../src/app/project-lock";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { loadConfig } from "../../src/config/load";
import { bindProviderCredential } from "../../src/config/provider-credential";
import { ProviderConfigSchema } from "../../src/config/schema";
import { setSecretBackend } from "../../src/config/secrets";
import { SkillSourceIdSchema } from "../../src/config/skills";
import type { Event } from "../../src/core/types";
import { withEnvelope } from "../../src/store/events/envelope";
import { MemoryStore } from "../../src/store/memory";
import { sessionPaths } from "../../src/store/paths";
import { emptyTwinState } from "../../src/twin/state";

const names = ["CONFIG", "PROFILE", "MODEL", "PROVIDER"].flatMap((name) => [
  `FLECTEN_${name}`,
  `LIQUID_${name}`,
]);
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const directories: string[] = [];

beforeEach(() => {
  for (const name of names) delete process.env[name];
  setSecretBackend("file");
});

afterEach(async () => {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  setSecretBackend(undefined);
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "flecten-migration-"));
  directories.push(path);
  return path;
}

function config() {
  const value = defaultConfig();
  value.useDefaults = false;
  value.provider = "test";
  value.model = "test";
  value.providers = {
    test: ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: "http://127.0.0.1:1",
      models: { test: { context: 200_000, output: 8_192, reasoning: false } },
    }),
  };
  value.catalog.autoRefresh = false;
  if (value.conversation) value.conversation.enabled = false;
  if (value.checkpoints) value.checkpoints.shell = false;
  value.skills = { sources: [] };
  return value;
}

test("startup migrates existing chats, memory, secrets and Twin without rewriting their evidence", async () => {
  const cwd = await directory();
  const legacy = join(cwd, ".liquid");
  const current = join(cwd, ".flecten");
  const sessionId = "migration-chat";
  const quote = "Liquid Harness: оставь путь .liquid/notes.txt слово в слово.";
  const digest = createHash("sha256").update(quote).digest("hex");
  const evidence = { sessionId, role: "user" as const, reference: "message-1", quote, digest };
  const memory = await new MemoryStore({ cwd, file: ".liquid/memory.json" }).put({
    key: "project/verbatim",
    kind: "preference",
    summary: "Preserve the user's wording",
    content: "Keep user messages verbatim.",
    reason: "The user requested exact preservation.",
    cues: ["transcript"],
    priority: "normal",
    sources: [evidence],
  });
  const events: Event[] = [
    { type: "session.started", sessionId, provider: "test", model: "test", prompt: quote },
    {
      type: "session.finished",
      sessionId,
      result: {
        sessionId,
        pass: true,
        stopReason: "done",
        summary: "Saved",
        turns: 1,
        usage: { input: 1, output: 1, cached: 0 },
      },
    },
  ];
  const journal = `${events.map((event, index) => JSON.stringify(withEnvelope(event, index + 1))).join("\n")}\n`;
  const logs = join(legacy, "sessions", sessionId, "logs");
  await mkdir(logs, { recursive: true });
  const value = config();
  const provider = value.providers.test;
  if (!provider) throw new Error("Missing fixture provider");
  const bytes = new Map<string, string | Buffer>([
    [`sessions/${sessionId}/events.jsonl`, journal],
    [`sessions/${sessionId}/logs/read.log`, quote],
    ["memory.json", await readFile(join(legacy, "memory.json"))],
    [
      "secrets.json",
      JSON.stringify({ test: bindProviderCredential(provider, "stored-credential") }),
    ],
    ["attachment.bin", Buffer.from([0, 1, 127, 255])],
    [
      "twin.json",
      JSON.stringify({
        ...emptyTwinState(),
        enabled: true,
        sourceIds: ["liquid"],
        entries: [
          {
            id: "retained-trait",
            kind: "preference",
            reaction: "like",
            strength: 2,
            voice: quote,
            summary: "Preserve wording",
            content: "Keep user messages verbatim.",
            appliesWhen: "Reading user messages",
            evidence: [
              { sourceId: "liquid", sessionId, reference: evidence.reference, quote, digest },
            ],
            revision: 1,
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    ],
  ]);
  for (const [path, contents] of bytes) await writeFile(join(legacy, path), contents);
  const configPath = join(cwd, "flecten.config.json");
  await writeFile(
    configPath,
    JSON.stringify({ ...value, skills: { sources: ["project-liquid"] } }),
  );
  process.env.FLECTEN_CONFIG = configPath;

  const loaded = await loadConfig(cwd);
  expect(loaded.providers.test?.apiKey).toBe("stored-credential");
  expect(loaded.skills?.sources).toEqual(["project-flecten"]);
  const service = await createAppService(cwd);
  try {
    expect(await service.listSessions()).toContainEqual(
      expect.objectContaining({ id: sessionId, title: quote }),
    );
    expect(await service.readSession(sessionId)).toMatchObject(events);
    expect(service.info().memory.records).toBe(1);
    expect(await new MemoryStore({ cwd }).list()).toEqual([memory]);
    const twin = await service.twin.get();
    expect(twin.sources.find((source) => source.id === "flecten")).toMatchObject({
      selected: true,
      path: join(current, "sessions"),
    });
    expect(twin.entries[0]?.evidence[0]).toMatchObject({ sourceId: "flecten", quote, digest });
    expect(sessionPaths(cwd, sessionId).events).toBe(
      join(current, "sessions", sessionId, "events.jsonl"),
    );
    for (const [path, contents] of bytes) {
      const expected = typeof contents === "string" ? Buffer.from(contents) : contents;
      expect((await readFile(join(current, path))).equals(expected)).toBe(true);
      expect((await readFile(join(legacy, path))).equals(expected)).toBe(true);
    }
    expect((await lstat(legacy)).isSymbolicLink()).toBe(true);
    expect(await realpath(legacy)).toBe(await realpath(current));
  } finally {
    await service.dispose();
  }
});

test("the global profile migrates its own file secrets before settings are loaded", async () => {
  const cwd = await directory();
  const profile = await directory();
  const value = config();
  const provider = value.providers.test;
  if (!provider) throw new Error("Missing fixture provider");
  const secrets = JSON.stringify({ test: bindProviderCredential(provider, "profile-credential") });
  await mkdir(join(profile, ".liquid"));
  await writeFile(join(profile, ".liquid/secrets.json"), secrets);
  await writeFile(join(profile, "flecten.config.json"), JSON.stringify(value));
  process.env.FLECTEN_PROFILE = profile;

  expect((await loadConfig(cwd)).providers.test?.apiKey).toBe("profile-credential");
  expect(await readFile(join(profile, ".flecten/secrets.json"), "utf8")).toBe(secrets);
  expect(await realpath(join(profile, ".liquid"))).toBe(await realpath(join(profile, ".flecten")));
});

test("locking a legacy project uses the canonical storage and leaves old saved paths readable", async () => {
  const cwd = await directory();
  const legacy = join(cwd, ".liquid");
  await mkdir(legacy);
  await writeFile(join(legacy, "checkpoint.bin"), Buffer.from([0, 13, 255]));
  const lock = await lockProject(cwd, 0);
  try {
    expect(lock.path).toBe(join(cwd, ".flecten", "sidecar.lock"));
    expect(await readFile(join(legacy, "checkpoint.bin"))).toEqual(Buffer.from([0, 13, 255]));
    expect(await realpath(legacy)).toBe(await realpath(join(cwd, ".flecten")));
  } finally {
    lock.release();
  }
});

test.each(["new", "current"])(
  "%s project and profile keep legacy writes in one store across restarts",
  async (initial) => {
    const cwd = await directory();
    const profile = await directory();
    if (initial === "current") {
      await mkdir(join(cwd, ".flecten"));
      await mkdir(join(profile, ".flecten"));
    }
    await writeFile(join(profile, "flecten.config.json"), JSON.stringify(config()));
    process.env.FLECTEN_PROFILE = profile;
    const sessionId = "compatibility-chat";
    const events: Event[] = [
      { type: "session.started", sessionId, provider: "test", model: "test", prompt: "Saved chat" },
      {
        type: "session.finished",
        sessionId,
        result: {
          sessionId,
          pass: true,
          stopReason: "done",
          summary: "Saved",
          turns: 1,
          usage: { input: 1, output: 1, cached: 0 },
        },
      },
    ];
    const journal = `${events.map((event, index) => JSON.stringify(withEnvelope(event, index + 1))).join("\n")}\n`;
    for (let startup = 0; startup < 2; startup += 1) {
      const lock = await lockProject(cwd, 0);
      try {
        expect(await realpath(join(cwd, ".liquid"))).toBe(await realpath(join(cwd, ".flecten")));
        const service = await createAppService(cwd);
        try {
          expect(await realpath(join(profile, ".liquid"))).toBe(
            await realpath(join(profile, ".flecten")),
          );
          const legacySession = join(cwd, ".liquid", "sessions", sessionId);
          if (startup === 0) {
            // An old backend writing its former path must extend the canonical store.
            await mkdir(legacySession, { recursive: true });
            await writeFile(join(legacySession, "events.jsonl"), journal);
          }
          expect(await service.listSessions()).toContainEqual(
            expect.objectContaining({ id: sessionId, title: "Saved chat" }),
          );
          expect(await service.readSession(sessionId)).toMatchObject(events);
          expect(await readFile(sessionPaths(cwd, sessionId).events, "utf8")).toBe(journal);
        } finally {
          await service.dispose();
        }
      } finally {
        lock.release();
      }
    }
  },
);

test.each(["config", "lock"])(
  "%s startup refuses independent old and new stores without overwriting either",
  async (entry) => {
    const cwd = await directory();
    for (const name of [".liquid", ".flecten"]) {
      await mkdir(join(cwd, name));
      await writeFile(join(cwd, name, "memory.json"), `original ${name}`);
    }
    await expect(entry === "config" ? loadConfig(cwd) : lockProject(cwd, 0)).rejects.toThrow(
      "Both",
    );
    for (const name of [".liquid", ".flecten"])
      expect(await readFile(join(cwd, name, "memory.json"), "utf8")).toBe(`original ${name}`);
  },
);

test("legacy Twin and skill source IDs resolve to the canonical Flecten IDs", () => {
  expect(TwinSourceIdSchema.parse("liquid")).toBe("flecten");
  expect(SkillSourceIdSchema.parse("user-liquid")).toBe("user-flecten");
  expect(SkillSourceIdSchema.parse("project-liquid")).toBe("project-flecten");
});
