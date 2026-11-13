import instructions from "../../../prompts/dictionary.md" with { type: "text" };
import {
  type DictionaryMatch,
  type DictionaryRecord,
  DictionaryRecordSchema,
} from "../../../shared/dictionary";
import { estimateMessages, PROFILE_4 } from "../../context";
import { matchDictionary } from "../../dictionary/match";
import { markdownData } from "../../util/markdown";
import { redact, redactKnown } from "../../util/redact";
import type { UserMessage } from "../types/message";
import { renderDictionaryMatch } from "./render";

export interface DictionaryPort {
  list(): Promise<DictionaryRecord[]>;
}

/** Ephemeral request data, never added to the transcript or used as memory evidence. */
export class DictionaryRuntime {
  readonly #port: DictionaryPort;
  readonly #secrets: readonly string[];
  readonly #active = new Map<string, string>();
  #prompt: string;

  constructor(port: DictionaryPort, prompt: string, secrets: readonly string[] = []) {
    this.#port = port;
    this.#prompt = prompt;
    this.#secrets = secrets;
  }

  observe(prompt: string): void {
    this.#prompt = prompt;
  }

  async delivery(budgetTokens: number): Promise<Pick<UserMessage, "role" | "content"> | undefined> {
    if (budgetTokens <= 0) return undefined;
    let matches: DictionaryMatch[];
    try {
      const entries = DictionaryRecordSchema.array()
        .max(5_500)
        .parse(await this.#port.list());
      const current = matchDictionary(this.#prompt, entries);
      const effective = new Map<string, DictionaryRecord>();
      for (const entry of entries) {
        if (entry.source === "local" || !effective.has(entry.id)) effective.set(entry.id, entry);
      }
      const latest = new Map(current.map((match) => [match.entry.id, match]));
      matches = [...current];
      for (const [id, matchedAlias] of this.#active) {
        const entry = effective.get(id);
        if (entry && !latest.has(id)) matches.push({ entry, matchedAlias });
      }
      this.#active.clear();
      for (const match of matches) this.#active.set(match.entry.id, match.matchedAlias);
    } catch (error) {
      return this.#bounded(
        markdownData(
          "Dictionary status",
          [["Status", "unavailable"]],
          error instanceof Error ? error.message : String(error),
        ),
        budgetTokens,
      );
    }
    const blocks: string[] = [];
    for (const match of matches) {
      const block = renderDictionaryMatch(
        {
          ...match,
          entry: {
            ...match.entry,
            definition: redactKnown(redact(match.entry.definition), this.#secrets),
          },
        },
        (candidate) => Boolean(this.#bounded([...blocks, candidate].join("\n\n"), budgetTokens)),
      );
      if (block) blocks.push(block);
    }
    return blocks.length ? this.#bounded(blocks.join("\n\n"), budgetTokens) : undefined;
  }

  #bounded(body: string, budgetTokens: number): Pick<UserMessage, "role" | "content"> | undefined {
    const message: Pick<UserMessage, "role" | "content"> = {
      role: "user",
      content: redactKnown(redact(`${instructions.trim()}\n\n${body}`), this.#secrets),
    };
    return estimateMessages([message], PROFILE_4).tokens <= Math.min(1200, budgetTokens)
      ? message
      : undefined;
  }
}
