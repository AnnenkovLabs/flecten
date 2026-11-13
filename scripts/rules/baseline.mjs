import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./graph.mjs";

export const BASELINE_FILE = join(root, "scripts/rules/baseline.json");

export function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return {};
  return JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
}

export function writeBaseline(value) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify(value, null, 2)}\n`);
}
