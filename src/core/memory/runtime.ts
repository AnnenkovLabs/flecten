import checkpointPrompt from "../../../prompts/memory-checkpoint.md" with { type: "text" };
import type { ContextMessage } from "../../context";
import { markdownData } from "../../util/markdown";
import type { Message, ToolResult } from "../types";
import { catalogReference, memoryTopics, recordTopics, topicLine } from "./catalog";
import {
  type MemoryCandidate,
  MemoryCandidateSchema,
  type MemoryCommand,
  MemoryCommandSchema,
  type MemoryDelivery,
} from "./command";
import { originalContextMessage } from "./context";
import { memoryDelivery } from "./delivery";
import { readMemories } from "./read";
import { memoryActive, memoryBody, memoryIndex } from "./render";
import { memoryWriteSchema } from "./schema";
import { memorySources, safeMemoryText, validateEvidence } from "./sources";
import type { MemoryPort, MemoryWrite } from "./types";
import { staleMemoryReferences, withdrawMemoryMessages } from "./withdraw";

export interface MemoryRuntimeOptions {
  port: MemoryPort;
  automaticRead?(): Promise<boolean>;
  automaticWrite?(): Promise<boolean>;
  sessionId: string;
  system: string;
  messages(): readonly Message[];
  secrets?: readonly string[] | undefined;
}

/** One run's capability. The port is shared; source authority and visibility are session local. */
export class MemoryRuntime {
  readonly #options: MemoryRuntimeOptions;
  #failure: string | undefined;
  #notice: string | undefined;
  constructor(options: MemoryRuntimeOptions) {
    this.#options = options;
  }

  takeNotice(): MemoryDelivery | undefined {
    if (!this.#notice) return undefined;
    const text = this.#notice;
    this.#notice = undefined;
    return { text, references: [] };
  }

  async refresh(budgetTokens = 1200) {
    const options = this.#options;
    try {
      if (options.automaticRead && !(await options.automaticRead())) return this.takeNotice();
      const records = await options.port.list();
      const withdrawn = staleMemoryReferences(records, options.messages());
      if (withdrawn.length) {
        withdrawMemoryMessages(options.messages(), withdrawn);
        const current =
          budgetTokens > 160
            ? memoryDelivery(
                records,
                options.messages(),
                options.sessionId,
                options.system,
                budgetTokens - 100,
              )
            : undefined;
        return {
          text: `# Project memory update\n\nEarlier saved-memory deliveries were superseded, expired or forgotten and have been withdrawn from this context. Disregard their old versions and any conclusions relying on them. Use memory for current records.${current ? `\n\n${current.text}` : ""}`,
          references: [...withdrawn, ...(current?.references ?? [])],
        };
      }
      this.#failure = undefined;
      const delivery = memoryDelivery(
        records,
        options.messages(),
        options.sessionId,
        options.system,
        budgetTokens,
      );
      const notice = this.takeNotice();
      if (!notice) return delivery;
      return {
        text: `${notice.text}\n\n${delivery?.text ?? ""}`,
        references: delivery?.references ?? [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = this.takeNotice();
      if (this.#failure === message) return notice;
      this.#failure = message;
      return {
        text: `${notice ? `${notice.text}\n\n` : ""}Project memory is unavailable: ${message}. Do not claim to have recalled or saved records.`,
        references: [],
      };
    }
  }

  checkpoint() {
    return {
      schema: MemoryCandidateSchema,
      instructions: checkpointPrompt,
      capture: async (value: unknown, messages: readonly ContextMessage[]) => {
        if (this.#options.automaticWrite && !(await this.#options.automaticWrite())) {
          throw new Error("Memory checkpoint is disabled by the current write policy.");
        }
        const candidates = MemoryCandidateSchema.array().max(3).parse(value);
        const originals = messages.flatMap((message) => {
          const original = originalContextMessage(message);
          return original ? [original] : [];
        });
        const sources = memorySources(originals, this.#options.sessionId);
        if (candidates.length)
          await this.#options.port.reconcile({
            save: candidates.map((candidate) => this.#draft(candidate, sources)),
            forget: [],
          });
      },
      failed: (error: unknown) => {
        this.#notice = `Memory checkpoint failed: ${error instanceof Error ? error.message : String(error)}\n\nThe conversation summary was preserved.`;
      },
    };
  }

  async execute(input: unknown): Promise<ToolResult> {
    try {
      return await this.#execute(MemoryCommandSchema.parse(input));
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async finish(value: unknown): Promise<ToolResult> {
    try {
      const candidates = MemoryCandidateSchema.array().max(3).parse(value);
      if (!candidates.length) return { ok: true, output: "No memory changes." };
      if (this.#options.automaticWrite && !(await this.#options.automaticWrite())) {
        throw new Error("Memory capture is disabled by the current write policy.");
      }
      return await this.#execute({ operation: "reconcile", save: candidates, forget: [] });
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #execute(command: MemoryCommand): Promise<ToolResult> {
    const options = this.#options;
    const messages = options.messages();
    const sources = memorySources(messages, options.sessionId);
    if (command.operation === "sources") {
      const selected = sources.slice(-12);
      return {
        ok: true,
        output:
          selected
            .map((source) =>
              markdownData(
                "Memory source",
                [
                  ["Role", source.role],
                  ["Reference", source.reference],
                  ["Source digest", source.digest],
                ],
                safeMemoryText(source.quote.slice(0, 2400), options.secrets ?? []),
              ),
            )
            .join("\n\n") || "No eligible sources.",
      };
    }
    if (command.operation === "save") return this.#save(command, sources);
    if (command.operation === "reconcile") {
      const result = await options.port.reconcile({
        save: command.save.map((candidate) => this.#draft(candidate, sources)),
        forget: command.forget,
      });
      return {
        ok: true,
        output: [
          "Memory changes committed atomically.",
          ...result.forgotten.map(
            (record) =>
              `Forgot memory ${record.id}, revision ${record.revision}. Earlier text is no longer valid.`,
          ),
          ...result.saved.map(memoryBody),
        ].join("\n\n"),
        data: {
          memoryReferences: [
            ...result.forgotten.map((record) => ({
              id: record.id,
              revision: record.revision,
              level: "invalidated",
            })),
            ...result.saved.map((record) => ({
              id: record.id,
              revision: record.revision,
              level: "full",
            })),
          ],
        },
      };
    }
    if (command.operation === "forget") {
      const record = await options.port.forget(command.id, command.expectedRevision);
      return {
        ok: true,
        output: `Forgot memory ${record.id}, revision ${record.revision}. Earlier text is no longer valid.`,
        data: {
          memoryReferences: [{ id: record.id, revision: record.revision, level: "invalidated" }],
        },
      };
    }
    const records = await options.port.list();
    if (command.operation === "topics") {
      const topics = memoryTopics(records);
      const cursor = command.cursor ?? 0;
      const selected = topics.slice(cursor, cursor + 12);
      return {
        ok: true,
        output: `${topics.length} topics. ${cursor + selected.length < topics.length ? `Next cursor: ${cursor + selected.length}.` : "End of topic directory."}\n\n${selected.map(([topic, count]) => topicLine(topic, count)).join("\n")}`,
        ...(cursor === 0 && selected.length === topics.length
          ? { data: { memoryReferences: [catalogReference(records)] } }
          : {}),
      };
    }
    if (command.operation === "read") {
      return readMemories(
        records,
        command.ids ?? [command.id ?? ""],
        messages,
        options.sessionId,
        options.system,
      );
    }
    const query = command.query?.normalize("NFKC").toLocaleLowerCase();
    const active = records.filter(
      (record) =>
        memoryActive(record) &&
        (!command.kind || record.kind === command.kind) &&
        (!command.topic || recordTopics(record).includes(command.topic)) &&
        (!query ||
          [record.key, record.summary, ...record.cues].some((value) =>
            value.normalize("NFKC").toLocaleLowerCase().includes(query),
          )),
    );
    const cursor = command.cursor ?? 0;
    const selected = active.slice(cursor, cursor + 12);
    return {
      ok: true,
      data: {
        memoryReferences: selected.map((record) => ({
          id: record.id,
          revision: record.revision,
          level: "index",
        })),
      },
      output: `${active.length} matching records. ${cursor + selected.length < active.length ? `Next cursor: ${cursor + selected.length}.` : "End of directory."}\n\n${selected.map(memoryIndex).join("\n")}`,
    };
  }

  async #save(
    candidate: MemoryCandidate,
    sources: ReturnType<typeof memorySources>,
  ): Promise<ToolResult> {
    const record = await this.#options.port.put(this.#draft(candidate, sources));
    return {
      ok: true,
      output: `Saved memory ${record.id}, revision ${record.revision}.\n\n${memoryBody(record)}`,
      data: { memoryReferences: [{ id: record.id, revision: record.revision, level: "full" }] },
    };
  }

  #draft(candidate: MemoryCandidate, sources: ReturnType<typeof memorySources>): MemoryWrite {
    const options = this.#options;
    const evidence = validateEvidence(candidate, sources, options.system, options.secrets ?? []);
    const {
      evidence: _quotes,
      operation: _operation,
      ...fields
    } = { ...candidate, operation: "save" };
    return memoryWriteSchema.parse({ ...fields, sources: evidence });
  }
}
