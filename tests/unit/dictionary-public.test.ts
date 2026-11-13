import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicDictionary } from "../../src/dictionary/public";

const term = {
  id: "new-term",
  term: "New term",
  category: "test",
  aliases: [],
  definition: "New definition",
  sources: [],
};
const manifest = { schemaVersion: 1, categories: ["test.json"] };
const category = { schemaVersion: 1, category: "test", entries: [term] };
function fetcher(read: (url: string) => Response | Promise<Response>): typeof fetch {
  return Object.assign(async (input: Parameters<typeof fetch>[0]) => read(String(input)), {
    preconnect: fetch.preconnect,
  });
}

describe("public dictionary snapshots", () => {
  test("ships offline seeds, syncs all categories and reopens a durable validated snapshot", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-dictionary-"));
    const requested: string[] = [];
    try {
      const dictionary = new PublicDictionary(cwd, {
        fetch: fetcher((url) => {
          requested.push(url);
          return Response.json(url.endsWith("index.json") ? manifest : category);
        }),
      });
      expect((await dictionary.load()).entries.map((entry) => entry.id)).toContain("liquid-glass");
      const snapshot = await dictionary.syncPublic();
      expect(snapshot.entries).toEqual([{ ...term, source: "public" }]);
      expect(snapshot.syncedAt).toBeDefined();
      expect(snapshot.error).toBeUndefined();
      expect(
        requested.every((url) =>
          url.startsWith(
            "https://raw.githubusercontent.com/AnnenkovLabs/flecten/main/src/dictionary/data/",
          ),
        ),
      ).toBe(true);
      expect((await new PublicDictionary(cwd).load()).entries).toEqual(snapshot.entries);
      await dictionary.refreshIfStale();
      expect(requested).toHaveLength(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("retains the last good disk and memory snapshot after incomplete or invalid refreshes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-dictionary-"));
    let broken = false;
    try {
      const dictionary = new PublicDictionary(cwd, {
        fetch: fetcher((url) => {
          if (url.endsWith("index.json"))
            return Response.json(
              broken ? { schemaVersion: 1, categories: ["test.json", "other.json"] } : manifest,
            );
          if (url.endsWith("other.json")) return Response.json({ broken: true });
          return Response.json(
            broken
              ? { ...category, entries: [{ ...term, definition: "Partial replacement" }] }
              : category,
          );
        }),
      });
      const good = await dictionary.syncPublic();
      broken = true;
      const failed = await dictionary.syncPublic();
      expect(failed.error).toContain("Retry the refresh");
      expect(failed.entries).toEqual(good.entries);
      expect(failed.syncedAt).toBe(good.syncedAt);
      expect((await new PublicDictionary(cwd).load()).entries).toEqual(good.entries);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("rejects oversized responses and aborts without losing offline definitions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-dictionary-"));
    try {
      const dictionary = new PublicDictionary(cwd, {
        fetch: fetcher(() => new Response(" ".repeat(513 * 1024))),
      });
      expect((await dictionary.syncPublic()).error).toContain("512 KiB");
      expect(dictionary.snapshot().entries.map((entry) => entry.id)).toContain("vibe-coding");
      const controller = new AbortController();
      controller.abort(new Error("cancelled"));
      await expect(dictionary.syncPublic(controller.signal)).rejects.toThrow("cancelled");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("reports corrupt cache and falls back to bundled definitions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-dictionary-"));
    try {
      const dictionary = new PublicDictionary(cwd, {
        fetch: fetcher((url) => Response.json(url.endsWith("index.json") ? manifest : category)),
      });
      await dictionary.syncPublic();
      await writeFile(join(cwd, ".liquid", "dictionary", "public.json"), "broken");
      const reopened = await new PublicDictionary(cwd).load();
      expect(reopened.error).toContain("Refresh it");
      expect(reopened.entries.map((entry) => entry.id)).toContain("liquid-glass");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
