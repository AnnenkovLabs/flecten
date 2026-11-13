import { type FileHandle, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { RedactionStream } from "../util/redaction-stream";

/** Incremental, redacted output on disk; at most one pipe chunk waits behind another. */
export class ProcessOutputLog {
  readonly #redactors: Record<"stdout" | "stderr", RedactionStream>;
  #writes: Promise<void> = Promise.resolve();

  private constructor(
    readonly path: string,
    private readonly file: FileHandle,
    secrets: readonly string[],
    private readonly onOutput?: (text: string) => void,
  ) {
    this.#redactors = {
      stdout: new RedactionStream(secrets),
      stderr: new RedactionStream(secrets),
    };
  }

  static async open(
    logDir: string,
    secrets: readonly string[] = [],
    onOutput?: (text: string) => void,
  ): Promise<ProcessOutputLog> {
    await mkdir(logDir, { recursive: true });
    const path = join(logDir, `bash-${crypto.randomUUID()}.log`);
    return new ProcessOutputLog(path, await open(path, "wx", 0o600), secrets, onOutput);
  }

  write(text: string, channel: "stdout" | "stderr" = "stdout"): Promise<void> {
    const safe = this.#redactors[channel].push(text);
    this.#writes = this.#writes.then(async () => {
      if (safe) {
        await this.file.writeFile(safe);
        this.onOutput?.(safe);
      }
    });
    return this.#writes;
  }

  async close(): Promise<void> {
    try {
      await this.#writes;
      for (const redactor of Object.values(this.#redactors)) {
        const tail = redactor.finish();
        if (tail) {
          await this.file.writeFile(tail);
          this.onOutput?.(tail);
        }
      }
      await this.file.sync();
    } finally {
      await this.file.close();
    }
  }
}
