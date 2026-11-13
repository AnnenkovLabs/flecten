import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Event, RunResult, ToolCall, ToolResult } from "../src/core/types";
import type { Checkpoint, CheckpointStore } from "../src/store/checkpoints";
import type { MockRequest } from "./mock-provider";
import type { BenchCheck } from "./schema";

export interface ToolRecord {
  call: ToolCall;
  result: ToolResult;
}

export interface Observation {
  result: RunResult;
  events: Event[];
  tools: ToolRecord[];
  requests: MockRequest[];
  checkpoints: Checkpoint[];
  store: CheckpointStore;
}

export interface CheckOutcome {
  type: BenchCheck["type"];
  ok: boolean | null;
  detail: string;
}

function outcome(type: BenchCheck["type"], ok: boolean | null, detail: string): CheckOutcome {
  return { type, ok, detail };
}

function fixturePath(cwd: string, path: string): string {
  const full = resolve(cwd, path);
  if (!full.startsWith(`${cwd}${sep}`)) throw new Error(`path escapes fixture: ${path}`);
  return full;
}

function records(observation: Observation, tool: string): ToolRecord[] {
  return observation.tools.filter((record) => record.call.name === tool);
}

function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function latestCheckpoint(observation: Observation): Checkpoint | undefined {
  return observation.checkpoints.at(-1);
}

async function fileCheck(
  check: Extract<BenchCheck, { type: "file_equals" | "file_contains" | "file_absent" }>,
  cwd: string,
): Promise<CheckOutcome> {
  const full = fixturePath(cwd, check.path);
  if (check.type === "file_absent") {
    try {
      await lstat(full);
      return outcome(check.type, false, `${check.path} exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return outcome(check.type, true, `${check.path} is absent`);
      }
      return outcome(check.type, false, `${check.path}: ${String(error)}`);
    }
  }
  let content: string;
  try {
    content = await readFile(full, "utf8");
  } catch (error) {
    return outcome(check.type, false, `${check.path}: ${String(error)}`);
  }
  if (check.type === "file_equals") {
    return content === check.content
      ? outcome(check.type, true, `${check.path} matches`)
      : outcome(check.type, false, `${check.path} is ${JSON.stringify(content)}`);
  }
  return content.includes(check.text)
    ? outcome(check.type, true, `${check.path} contains ${JSON.stringify(check.text)}`)
    : outcome(check.type, false, `${check.path} does not contain ${JSON.stringify(check.text)}`);
}

export async function evaluateChecks(
  checks: BenchCheck[],
  cwd: string,
  observation?: Observation,
): Promise<CheckOutcome[]> {
  const results: CheckOutcome[] = [];
  let unavailableRestore = false;
  for (const check of checks) {
    if (!observation && check.type === "checkpoint_restore") unavailableRestore = true;
    if (unavailableRestore) {
      results.push(outcome(check.type, null, "Checkpoint restore and its subsequent checks are not observable in this baseline."));
      continue;
    }
    if (check.type === "file_equals" || check.type === "file_contains" || check.type === "file_absent") {
      results.push(await fileCheck(check, cwd));
      continue;
    }
    if (observation === undefined) {
      results.push(outcome(check.type, null, "not evaluable outside the harness"));
      continue;
    }
    results.push(await evaluate(check, observation));
  }
  return results;
}

async function evaluate(check: BenchCheck, observation: Observation): Promise<CheckOutcome> {
  switch (check.type) {
    case "result": {
      const reasonOk = check.stopReason === undefined || observation.result.stopReason === check.stopReason;
      const passOk = check.pass === undefined || observation.result.pass === check.pass;
      return outcome(
        check.type,
        reasonOk && passOk,
        `stop=${observation.result.stopReason} pass=${observation.result.pass}`,
      );
    }
    case "tool_ok": {
      const found = records(observation, check.tool);
      const ok = found.length > 0 && found.every((record) => record.result.ok);
      return outcome(check.type, ok, `${check.tool}: ${found.length} call(s), ok=${ok}`);
    }
    case "tool_error": {
      const errors = records(observation, check.tool)
        .map((record) => record.result.error ?? "")
        .filter((error) => error.length > 0);
      const contains = check.contains;
      const ok =
        contains === undefined
          ? errors.length > 0
          : errors.some((error) => error.includes(contains));
      return outcome(check.type, ok, errors.join(" | ") || "no error");
    }
    case "tool_output_contains": {
      const found = records(observation, check.tool);
      const ok = found.some((record) => record.result.output.includes(check.text));
      return outcome(check.type, ok, `${check.tool}: contains=${ok}`);
    }
    case "tool_output_not_contains": {
      const output = records(observation, check.tool)
        .map((record) => record.result.output)
        .join("\n");
      const ok = !output.includes(check.text);
      return outcome(check.type, ok, `${check.tool}: absent=${ok}`);
    }
    case "tool_data": {
      const record = records(observation, check.tool)[0];
      const actual = valueAt(record?.result.data, check.path);
      const ok = Object.is(actual, check.equals);
      return outcome(check.type, ok, `${check.tool}.${check.path}=${JSON.stringify(actual)}`);
    }
    case "checkpoint_count": {
      const ok = observation.checkpoints.length === check.count;
      return outcome(check.type, ok, `${observation.checkpoints.length} checkpoint(s)`);
    }
    case "checkpoint_tool": {
      const latest = latestCheckpoint(observation);
      const ok = latest?.tool === check.tool;
      return outcome(check.type, ok, `latest tool=${latest?.tool ?? "none"}`);
    }
    case "checkpoint_finalized": {
      const latest = latestCheckpoint(observation);
      const ok = latest?.finalizedAt !== undefined;
      return outcome(check.type, ok, `finalized=${ok}`);
    }
    case "checkpoint_paths": {
      const latest = latestCheckpoint(observation);
      const paths = latest?.files.map((file) => file.path) ?? [];
      const ok = check.paths.every((path) => paths.includes(path));
      return outcome(check.type, ok, paths.join(", ") || "no checkpoint");
    }
    case "checkpoint_restore": {
      const latest = latestCheckpoint(observation);
      if (latest === undefined) return outcome(check.type, false, "no checkpoint");
      try {
        const restored = await observation.store.restore(latest.id, check.target);
        return outcome(
          check.type,
          true,
          `restored ${restored.restored.join(", ") || "none"}; removed ${restored.removed.join(", ") || "none"}`,
        );
      } catch (error) {
        return outcome(check.type, false, error instanceof Error ? error.message : String(error));
      }
    }
    case "compaction_count": {
      const events = observation.events.filter((event) => event.type === "context.compacted");
      const ok = events.length >= check.min;
      return outcome(check.type, ok, `${events.length} compaction event(s)`);
    }
    case "compaction_summary_contains": {
      const events = observation.events.filter((event) => event.type === "context.compacted");
      const ok = events.some(
        (event) => event.type === "context.compacted" && event.summary.includes(check.text),
      );
      return outcome(check.type, ok, `summary contains=${ok}`);
    }
    case "request_count": {
      const count = observation.requests.length;
      const ok =
        (check.min === undefined || count >= check.min) &&
        (check.max === undefined || count <= check.max);
      return outcome(check.type, ok, `${count} request(s)`);
    }
    case "request_contains": {
      const text = JSON.stringify(observation.requests.map((request) => request.body));
      const ok = text.includes(check.text);
      return outcome(check.type, ok, `contains=${ok}`);
    }
  }
  throw new Error("unhandled benchmark check");
}
