import { strict as assert } from "node:assert";
import { flushSync } from "svelte";
import { attachDraftFiles } from "../../ui/src/lib/composer/attachment-draft";
import { DraftStorage } from "../../ui/src/lib/composer/draft-storage";
import {
  clearComposerDraft,
  composerDrafts,
  composerTaskKey,
  listenComposerDrafts,
  moveComposerDraft,
  savedComposerTask,
  setComposerProject,
  setComposerTask,
  writeComposerDraft,
} from "../../ui/src/lib/composer/drafts.svelte";
import type { PromptSnapshot } from "../../ui/src/lib/composer/prompt-document";

class Profile implements Storage {
  readonly values = new Map<string, string>();
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
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function snapshot(text: string, path: string): PromptSnapshot {
  const start = text.indexOf(`@${path}`);
  return { text, mentions: [{ start, end: start + path.length + 1, path, kind: "file" }] };
}

export function verifyComposerDrafts(): void {
  const profile = new Profile();
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = Object.assign(new EventTarget(), {
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: profile });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  const stop = listenComposerDrafts();
  let rendered = "";
  const dispose = $effect.root(() => {
    $effect(() => {
      rendered = composerDrafts.values[composerDrafts.task] ?? "";
    });
  });
  const disk = new DraftStorage(() => profile);
  const flush = (): void => {
    target.dispatchEvent(new Event("beforeunload"));
    flushSync();
  };
  try {
    const previous = snapshot("  saved @README.md\n", "README.md");
    const typed = snapshot("typed @later.ts\n\t ", "later.ts");
    const currentKey = JSON.stringify(["/project-a", "current"]);
    disk.write(currentKey, { document: previous, attachments: [] });
    disk.focus("/project-a", "old-chat");
    disk.flush();
    const unboundKey = composerDrafts.task;
    writeComposerDraft(typed.text, typed.mentions);
    setComposerProject("/project-a");
    flush();
    const combined = `${previous.text}\n\n${typed.text}`;
    assert.equal(rendered, combined);
    assert.equal(savedComposerTask(), null);
    assert.equal(composerDrafts.values[unboundKey], undefined);
    assert.equal(disk.read(unboundKey), null);
    assert.deepEqual(disk.read(currentKey)?.document, {
      text: combined,
      mentions: [
        ...previous.mentions,
        ...typed.mentions.map((mention) => ({
          ...mention,
          start: mention.start + previous.text.length + 2,
          end: mention.end + previous.text.length + 2,
        })),
      ],
    });

    const chatKey = composerTaskKey("chat-a");
    moveComposerDraft(currentKey, chatKey);
    setComposerTask("chat-a");
    flushSync();
    assert.equal(rendered, combined);
    assert.equal(disk.read(currentKey), null);
    assert.equal(disk.read(chatKey)?.document.text, combined);
    setComposerTask("chat-b");
    writeComposerDraft("  second chat\n ");
    setComposerTask("chat-a");
    flushSync();
    assert.equal(rendered, combined);
    assert.equal(disk.read(composerTaskKey("chat-b"))?.document.text, "  second chat\n ");

    const pickerDestination = composerDrafts.task;
    setComposerProject("/project-b");
    setComposerTask("chat-a");
    const otherProjectKey = composerDrafts.task;
    writeComposerDraft("Other project stays here");
    attachDraftFiles(pickerDestination, [
      { path: "/project-a/late.png", name: "late.png", size: 40, kind: "image" },
      { path: "/project-a/late.pdf", name: "late.pdf", size: 90, kind: "pdf" },
    ]);
    flush();
    assert.equal(rendered, "Other project stays here");
    assert.equal(disk.read(otherProjectKey)?.document.text, "Other project stays here");
    assert(disk.read(pickerDestination)?.document.text.includes("@/project-a/late.png"));
    assert.equal(disk.read(pickerDestination)?.attachments[0]?.path, "/project-a/late.pdf");
    assert.equal(disk.read(otherProjectKey)?.attachments.length, 0);
    setComposerProject("/project-a");
    setComposerTask("chat-a");
    flushSync();
    assert(rendered.includes("@/project-a/late.png"));
    clearComposerDraft(chatKey);
    flushSync();
    assert.equal(rendered, "");
    assert.equal(disk.read(chatKey), null);
    assert.equal(composerDrafts.documents[chatKey], undefined);
    assert.equal(composerDrafts.attachments[chatKey], undefined);
    assert.equal(disk.read(otherProjectKey)?.document.text, "Other project stays here");
  } finally {
    dispose();
    stop();
    if (savedStorage) Object.defineProperty(globalThis, "localStorage", savedStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}
