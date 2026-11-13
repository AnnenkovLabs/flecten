import type { QueueItem } from "../queue/types";
import type { Command } from "../types";
import type { SessionOptions } from "./options";

/** Delegates retain a run's original human authority, which later human steering can revoke. */
export class SessionPermissionIntent {
  #revoke = () => {};
  #read: () => string | undefined = () => undefined;

  forRun(options: SessionOptions, prompt: string, internal = false) {
    const human = !internal && options.role !== "worker";
    let source = human ? prompt : undefined;
    if (human) {
      this.#revoke();
      this.#revoke = () => {
        source = undefined;
      };
      this.#read = () => source;
    }
    return {
      input: human ? { userSource: prompt, allowUserMemory: true } : {},
      read: options.permissionIntent ?? (options.role === "worker" ? () => undefined : this.#read),
    };
  }

  beforeCommand(command: Command, role: SessionOptions["role"], items: readonly QueueItem[]) {
    if (role === "worker") return;
    if (
      (command.type === "queue.add" && command.mode === "steer") ||
      (command.type === "queue.edit" &&
        items.some((item) => item.id === command.id && item.mode === "steer"))
    )
      this.#revoke();
  }
}
