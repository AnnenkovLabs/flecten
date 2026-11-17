import { afterEach, expect, jest, test } from "bun:test";
import {
  DRAFT_SAVE_DELAY_MS,
  DraftStorage,
  type SavedDraft,
} from "../../ui/src/lib/composer/draft-storage";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  writes = 0;
  failWrites = false;
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    if (this.failWrites) throw new Error("Storage is full");
    this.values.delete(key);
    this.writes++;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("Storage is full");
    this.values.set(key, value);
    this.writes++;
  }
}

function draft(text: string): SavedDraft {
  return { document: { text, mentions: [] }, attachments: [] };
}

afterEach(() => jest.useRealTimers());

test("continuous edits save at the fixed deadline without writing every keystroke", () => {
  jest.useFakeTimers();
  const profile = new MemoryStorage();
  const storage = new DraftStorage(() => profile);
  storage.write("chat", draft("first"));
  jest.advanceTimersByTime(DRAFT_SAVE_DELAY_MS / 2);
  storage.write("chat", draft("latest"));
  jest.advanceTimersByTime(DRAFT_SAVE_DELAY_MS / 2 - 1);
  expect(profile.writes).toBe(0);
  jest.advanceTimersByTime(1);
  expect(profile.writes).toBe(1);
  expect(storage.read("chat")).toEqual(draft("latest"));

  for (let index = 0; index < 4; index++) {
    storage.write("chat", draft(`continued ${index}`));
    jest.advanceTimersByTime(DRAFT_SAVE_DELAY_MS / 4);
  }
  expect(profile.writes).toBe(2);
  expect(storage.read("chat")).toEqual(draft("continued 3"));
});

test("separate records survive reopening, suppress duplicates and remove cleared drafts", () => {
  const profile = new MemoryStorage();
  const storage = new DraftStorage(() => profile);
  const first = JSON.stringify(["/project-a", "current"]);
  const second = JSON.stringify(["/project-b", "current"]);
  storage.write(first, draft("Project A"));
  storage.write(second, draft("Project B"));
  storage.flush();
  expect(profile.length).toBe(2);
  storage.write(first, draft("Project A"));
  storage.flush();
  expect(profile.writes).toBe(2);

  const reopened = new DraftStorage(() => profile);
  expect(reopened.read(first)).toEqual(draft("Project A"));
  expect(reopened.read(second)).toEqual(draft("Project B"));
  reopened.write(first, null);
  reopened.flush();
  expect(new DraftStorage(() => profile).read(first)).toBeNull();
  expect(reopened.read(second)).toEqual(draft("Project B"));
  expect(profile.length).toBe(1);
});

test("restoration preserves literal text and structured references and rejects malformed records", () => {
  const profile = new MemoryStorage();
  let errors = 0;
  const storage = new DraftStorage(
    () => profile,
    () => errors++,
  );
  const text = "\n  Проверь @README.md  \n\tбез изменений  ";
  const start = text.indexOf("@README.md");
  const saved: SavedDraft = {
    document: {
      text,
      mentions: [{ start, end: start + "@README.md".length, path: "README.md", kind: "file" }],
    },
    attachments: [{ id: "pdf", name: "notes.pdf", size: 512, kind: "pdf", path: "/notes.pdf" }],
  };
  storage.write("chat", saved);
  storage.flush();
  expect(new DraftStorage(() => profile).read("chat")).toEqual(saved);

  const key = profile.key(0);
  expect(key).not.toBeNull();
  if (!key) throw new Error("Missing saved record");
  profile.setItem(key, JSON.stringify({ ...saved, document: { text, mentions: [{ start: 90 }] } }));
  expect(storage.read("chat")).toBeNull();
  profile.setItem(key, "broken JSON");
  expect(storage.read("chat")).toBeNull();
  expect(errors).toBe(1);
});

test("failed writes retain the newest pending value and report once until recovery", () => {
  const profile = new MemoryStorage();
  let errors = 0;
  const storage = new DraftStorage(
    () => profile,
    () => errors++,
  );
  profile.failWrites = true;
  storage.write("chat", draft("first"));
  storage.flush();
  storage.write("chat", draft("latest while full"));
  storage.flush();
  expect(errors).toBe(1);
  expect(profile.length).toBe(0);

  profile.failWrites = false;
  storage.flush();
  expect(new DraftStorage(() => profile).read("chat")).toEqual(draft("latest while full"));
  profile.failWrites = true;
  storage.write("chat", null);
  storage.flush();
  expect(errors).toBe(2);
  profile.failWrites = false;
  storage.flush();
  expect(new DraftStorage(() => profile).read("chat")).toBeNull();
});

test("leaving, hiding and disposing a window flush pending text and clean up listeners", () => {
  const profile = new MemoryStorage();
  const storage = new DraftStorage(() => profile);
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const target = Object.assign(new EventTarget(), { document });
  const stop = storage.listen(target as unknown as Window);
  for (const event of ["blur", "pagehide", "beforeunload"]) {
    storage.write("chat", draft(event));
    target.dispatchEvent(new Event(event));
    expect(new DraftStorage(() => profile).read("chat")).toEqual(draft(event));
  }
  storage.write("chat", draft("hidden"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(storage.read("chat")).toEqual(draft("beforeunload"));
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(storage.read("chat")).toEqual(draft("hidden"));

  storage.write("chat", draft("disposed"));
  stop();
  expect(storage.read("chat")).toEqual(draft("disposed"));
  storage.write("chat", draft("after dispose"));
  target.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(storage.read("chat")).toEqual(draft("disposed"));
  storage.flush();
});
