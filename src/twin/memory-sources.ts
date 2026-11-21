import { Database } from "bun:sqlite";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import type { TwinSourceId } from "../../shared/twin";
import type { SourceMessage } from "./sources";
import {
  collectCommandCodeTaste,
  listMatchingFiles,
  makeMemoryMessage,
  readRegularText,
  splitMarkdownMemory,
} from "./taste-sources";

export { collectCommandCodeTaste, parseTasteMarkdown } from "./taste-sources";

async function readMnemopiMemories(
  home: string,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<SourceMessage[]> {
  const banksRoot = join(home, ".omp/agent/memories/mnemopi/banks");
  const dbs = await listMatchingFiles(banksRoot, signal, (f) => basename(f) === "mnemopi.db", 2);
  const out: SourceMessage[] = [];
  for (const dbPath of dbs) {
    signal.throwIfAborted();
    let db: Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true, strict: true });
      const tables = z
        .array(z.object({ name: z.string() }))
        .parse(db.query("SELECT name FROM sqlite_master WHERE type='table'").all())
        .map((r) => r.name);

      if (tables.includes("memoria_preferences")) {
        const rows = z
          .array(
            z.object({
              id: z.number(),
              preference: z.string(),
              topic: z.string().nullable().optional(),
            }),
          )
          .parse(db.query("SELECT id, preference, topic FROM memoria_preferences").all());
        for (const row of rows) {
          const text = row.topic
            ? `[OMP Memory / Preference: ${row.topic}] ${row.preference}`
            : `[OMP Memory / Preference] ${row.preference}`;
          const msg = makeMemoryMessage(
            "omp",
            `memory:${dbPath}`,
            `${dbPath}#pref-${row.id}`,
            text,
            secrets,
          );
          if (msg) out.push(msg);
        }
      }
      if (tables.includes("memoria_instructions")) {
        const rows = z
          .array(
            z.object({
              id: z.number(),
              instruction: z.string(),
              topic: z.string().nullable().optional(),
            }),
          )
          .parse(
            db
              .query("SELECT id, instruction, topic FROM memoria_instructions WHERE active = 1")
              .all(),
          );
        for (const row of rows) {
          const text = row.topic
            ? `[OMP Memory / Instruction: ${row.topic}] ${row.instruction}`
            : `[OMP Memory / Instruction] ${row.instruction}`;
          const msg = makeMemoryMessage(
            "omp",
            `memory:${dbPath}`,
            `${dbPath}#instr-${row.id}`,
            text,
            secrets,
          );
          if (msg) out.push(msg);
        }
      }
      if (tables.includes("memoria_facts")) {
        const rows = z
          .array(
            z.object({
              id: z.number(),
              fact_type: z.string().nullable().optional(),
              key: z.string().nullable().optional(),
              value: z.string(),
            }),
          )
          .parse(db.query("SELECT id, fact_type, key, value FROM memoria_facts").all());
        for (const row of rows) {
          const label = [row.fact_type, row.key].filter(Boolean).join(": ");
          const text = label ? `[OMP Memory / ${label}] ${row.value}` : `[OMP Memory] ${row.value}`;
          const msg = makeMemoryMessage(
            "omp",
            `memory:${dbPath}`,
            `${dbPath}#fact-${row.id}`,
            text,
            secrets,
          );
          if (msg) out.push(msg);
        }
      }
      if (tables.includes("working_memory")) {
        const rows = z
          .array(
            z.object({
              id: z.string(),
              content: z.string(),
              memory_type: z.string().nullable().optional(),
            }),
          )
          .parse(
            db
              .query(
                "SELECT id, content, memory_type FROM working_memory WHERE superseded_by IS NULL",
              )
              .all(),
          );
        for (const row of rows) {
          const text =
            row.memory_type && row.memory_type !== "unknown"
              ? `[OMP Memory / ${row.memory_type}] ${row.content}`
              : `[OMP Memory] ${row.content}`;
          const msg = makeMemoryMessage(
            "omp",
            `memory:${dbPath}`,
            `${dbPath}#wm-${row.id}`,
            text,
            secrets,
          );
          if (msg) out.push(msg);
        }
      }
    } catch {
      // Ignore unreadable or busy mnemopi SQLite banks
    } finally {
      db?.close();
    }
  }
  return out;
}

async function readCodexMemories(
  home: string,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<SourceMessage[]> {
  const out: SourceMessage[] = [];
  const mdFiles = await listMatchingFiles(
    join(home, ".codex/memories"),
    signal,
    (f) => extname(f) === ".md",
    2,
  );
  for (const file of mdFiles) {
    const content = await readRegularText(file, signal);
    if (content)
      out.push(...splitMarkdownMemory(content, "codex", file, `Codex ${basename(file)}`, secrets));
  }
  const dbs = await listMatchingFiles(
    join(home, ".codex"),
    signal,
    (f) => {
      const name = basename(f).toLowerCase();
      return name.startsWith("memories") && name.endsWith(".sqlite");
    },
    1,
  );
  for (const dbPath of dbs) {
    signal.throwIfAborted();
    let db: Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true, strict: true });
      const tables = z
        .array(z.object({ name: z.string() }))
        .parse(db.query("SELECT name FROM sqlite_master WHERE type='table'").all())
        .map((r) => r.name);
      if (tables.includes("stage1_outputs")) {
        const rows = z
          .array(
            z.object({
              thread_id: z.string(),
              raw_memory: z.string().nullable().optional(),
              rollout_summary: z.string().nullable().optional(),
            }),
          )
          .parse(
            db.query("SELECT thread_id, raw_memory, rollout_summary FROM stage1_outputs").all(),
          );
        for (const row of rows) {
          const body = [row.raw_memory, row.rollout_summary].filter(Boolean).join("\n\n");
          if (!body) continue;
          const msg = makeMemoryMessage(
            "codex",
            `memory:${row.thread_id}`,
            `${dbPath}#${row.thread_id}`,
            `[Codex Memory]\n${body}`,
            secrets,
          );
          if (msg) out.push(msg);
        }
      }
    } catch {
      // Ignore unreadable or busy codex SQLite memory stores
    } finally {
      db?.close();
    }
  }
  return out;
}

async function readOpenCodeInstructions(
  home: string,
  secrets: readonly string[],
): Promise<SourceMessage[]> {
  const dbPath = join(home, ".local/share/opencode/opencode.db");
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, strict: true });
    const tables = z
      .array(z.object({ name: z.string() }))
      .parse(db.query("SELECT name FROM sqlite_master WHERE type='table'").all())
      .map((r) => r.name);
    if (!tables.includes("instruction_entry")) return [];
    const rows = z
      .array(z.object({ session_id: z.string(), key: z.string(), value: z.string().nullable() }))
      .parse(
        db
          .query(
            "SELECT session_id, key, value FROM instruction_entry WHERE removed = 0 AND value IS NOT NULL",
          )
          .all(),
      );
    const out: SourceMessage[] = [];
    for (const row of rows) {
      if (!row.value) continue;
      const msg = makeMemoryMessage(
        "opencode",
        `memory:${row.session_id}`,
        `${dbPath}#${row.key}`,
        `[OpenCode Memory / ${row.key}] ${row.value}`,
        secrets,
      );
      if (msg) out.push(msg);
    }
    return out;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** Collect saved memory / instruction / taste stores for each selected harness. */
export async function collectHarnessMemories(
  sourceId: TwinSourceId,
  cwd: string,
  home: string,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<SourceMessage[]> {
  signal.throwIfAborted();
  if (sourceId === "commandcode")
    return (await collectCommandCodeTaste(cwd, home, secrets, signal)).messages;
  if (sourceId === "omp") {
    const out = await readMnemopiMemories(home, secrets, signal);
    const mdFiles = await listMatchingFiles(
      join(home, ".omp/agent/memories"),
      signal,
      (f) => extname(f) === ".md",
      4,
    );
    for (const file of [...mdFiles, join(home, ".omp/agent/AGENTS.md")]) {
      const text = await readRegularText(file, signal);
      if (text) out.push(...splitMarkdownMemory(text, "omp", file, "OMP Memory", secrets));
    }
    return out;
  }
  if (sourceId === "codex") {
    const out = await readCodexMemories(home, secrets, signal);
    for (const file of [join(home, ".codex/AGENTS.md"), join(cwd, "AGENTS.md")]) {
      const text = await readRegularText(file, signal);
      if (text)
        out.push(...splitMarkdownMemory(text, "codex", file, "Codex Instructions", secrets));
    }
    return out;
  }
  if (sourceId === "opencode") return readOpenCodeInstructions(home, secrets);
  if (sourceId === "flecten") {
    const memPath = join(cwd, ".flecten/memory.json");
    const text = await readRegularText(memPath, signal);
    if (!text) return [];
    try {
      const parsed = z
        .object({
          records: z.array(
            z.object({
              id: z.string(),
              kind: z.string().optional(),
              summary: z.string(),
              content: z.string(),
            }),
          ),
        })
        .safeParse(JSON.parse(text));
      if (!parsed.success) return [];
      return parsed.data.records.flatMap((rec) => {
        const msg = makeMemoryMessage(
          "flecten",
          `memory:${rec.id}`,
          `${memPath}#${rec.id}`,
          `[Flecten Memory / ${rec.kind ?? "context"}] ${rec.summary}\n${rec.content}`,
          secrets,
        );
        return msg ? [msg] : [];
      });
    } catch {
      return [];
    }
  }
  const mdMap: Partial<Record<TwinSourceId, { files: Promise<string[]>; label: string }>> = {
    claude: {
      label: "Claude Memory",
      files: listMatchingFiles(
        join(home, ".claude/projects"),
        signal,
        (f) => f.replaceAll("\\", "/").includes("/memory/") && extname(f) === ".md",
        4,
      ).then((found) => [
        ...found,
        join(home, ".claude/CLAUDE.md"),
        join(cwd, "CLAUDE.md"),
        join(cwd, ".claude/CLAUDE.md"),
      ]),
    },
    hermes: {
      label: "Hermes Memory",
      files: listMatchingFiles(
        join(home, ".hermes/memories"),
        signal,
        (f) => extname(f) === ".md" || extname(f) === ".txt",
        3,
      ),
    },
    kilo: {
      label: "Kilo Memory",
      files: listMatchingFiles(
        join(home, ".kilo/memory"),
        signal,
        (f) => extname(f) === ".md",
        3,
      ).then((found) => [
        ...found,
        join(home, ".config/kilo/AGENTS.md"),
        join(home, ".kilo/AGENTS.md"),
      ]),
    },
    deepseek: {
      label: "DSH Memory",
      files: listMatchingFiles(join(home, ".dsh/memories"), signal, (f) => extname(f) === ".md", 3),
    },
    cursor: {
      label: "Cursor Rules",
      files: listMatchingFiles(
        join(cwd, ".cursor/rules"),
        signal,
        (f) => extname(f) === ".md" || extname(f) === ".mdc",
        3,
      ).then((found) => [...found, join(cwd, ".cursorrules")]),
    },
  };
  const spec = mdMap[sourceId];
  if (!spec) return [];
  const out: SourceMessage[] = [];
  for (const file of new Set(await spec.files)) {
    const text = await readRegularText(file, signal);
    if (text) out.push(...splitMarkdownMemory(text, sourceId, file, spec.label, secrets));
  }
  return out;
}
