import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Event } from "../../src/core/types";
import { redactValue } from "../../src/util/redact";

export async function appendEvent(path: string, event: Event): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(redactValue(event))}\n`, "utf8");
}
