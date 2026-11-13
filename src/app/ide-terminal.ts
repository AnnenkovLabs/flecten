import { z } from "zod";
import { TerminalManager } from "../terminal/manager";
import type { TerminalSettingsInput } from "../terminal/settings";
import { redact } from "../util/redact";

const Input = z.object({
  action: z.enum(["read", "write", "resize", "restart", "stop"]),
  data: z.string().max(65536).optional(),
  cursor: z.number().int().nonnegative().default(0),
  cols: z.number().int().min(10).max(500).default(100),
  rows: z.number().int().min(2).max(200).default(24),
});

/** A user-owned PTY, isolated from the agent's terminal and disposed with the project. */
export class IdeTerminal {
  #manager = new TerminalManager();
  #buffer = "";
  #base = 0;
  #epoch = 0;
  constructor(
    private cwd: string,
    private settings: () => TerminalSettingsInput,
  ) {}

  async command(
    input: unknown,
  ): Promise<{ data: string; cursor: number; epoch: number; reset: boolean; running: boolean }> {
    const command = Input.parse(input);
    if (command.action === "restart") {
      await this.#manager.close("ide");
      this.#buffer = "";
      this.#base = 0;
      this.#epoch += 1;
    }
    let terminal = this.#manager.get("ide");
    if (!terminal && command.action !== "stop") {
      this.#manager.configure(this.settings());
      terminal = this.#manager.create("ide", {
        cwd: this.cwd,
        cols: command.cols,
        rows: command.rows,
        ansi: true,
      });
      terminal.onEvent((event) => {
        if (event.type !== "data") return;
        this.#buffer += event.data;
        if (this.#buffer.length > 256 * 1024) {
          const dropped = this.#buffer.length - 128 * 1024;
          this.#buffer = this.#buffer.slice(dropped);
          this.#base += dropped;
        }
      });
    }
    if (command.action === "write" && command.data) terminal?.write(command.data);
    if (command.action === "resize") terminal?.resize(command.cols, command.rows);
    if (command.action === "stop") await this.#manager.close("ide");
    const reset = command.cursor < this.#base || command.cursor > this.#base + this.#buffer.length;
    const start = reset ? 0 : command.cursor - this.#base;
    // Redact the complete retained output before taking the cursor slice, including split tokens.
    const safe = redact(this.#buffer);
    const data = safe.length === this.#buffer.length ? safe.slice(start) : safe;
    return {
      data: command.action === "read" || command.action === "restart" ? data : "",
      cursor: this.#base + this.#buffer.length,
      epoch: this.#epoch,
      reset: reset || safe.length !== this.#buffer.length,
      running: terminal?.snapshot().running ?? false,
    };
  }
  dispose(): Promise<void> {
    return this.#manager.closeAll();
  }
}
