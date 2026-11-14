import { createInterface } from "node:readline";

/** Each reader belongs to one child generation, including already buffered lines. */
export function watchAgentOutput(child, { current, message, stderr, invalid, exited, failed }) {
  const stdout = createInterface({ input: child.stdout });
  const errorOutput = createInterface({ input: child.stderr });
  const close = () => { stdout.close(); errorOutput.close(); };
  stdout.on("line", (line) => {
    if (!current() || line.trim().length === 0) return;
    let value;
    try { value = JSON.parse(line); }
    catch { invalid(); return; }
    if (value === null || typeof value !== "object" || Array.isArray(value)) { invalid(); return; }
    message(value);
  });
  errorOutput.on("line", (line) => { if (current()) stderr(line); });
  child.on("error", (error) => { close(); if (current()) failed(error); });
  child.on("exit", (code, signal) => { close(); if (current()) exited(code, signal); });
  return close;
}
