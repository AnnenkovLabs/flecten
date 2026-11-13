import { appendFileSync } from "node:fs";

const input = await Bun.stdin.text();
const parsed = JSON.parse(input) as { toolName?: string };
const event = process.env.FLECTEN_HOOK_EVENT ?? "unknown";
const log = process.env.FLECTEN_HOOK_LOG;

if (log) {
  appendFileSync(log, `${JSON.stringify({ event, input: parsed })}\n`);
}

const action = process.argv[2];
if ((action === "mark" || action === "mark-timeout") && process.env.FLECTEN_HOOK_MARK) {
  appendFileSync(process.env.FLECTEN_HOOK_MARK, `hook:${event}:${parsed.toolName ?? ""}\n`);
  if (action === "mark-timeout") await Bun.sleep(5000);
} else if (action === "slow-mark" && process.env.FLECTEN_HOOK_MARK) {
  await Bun.sleep(400);
  appendFileSync(process.env.FLECTEN_HOOK_MARK, `hook:${event}:${parsed.toolName ?? ""}\n`);
} else if (action === "context") {
  process.stdout.write(`${JSON.stringify({ additionalContext: `context from ${event}` })}\n`);
} else if (action === "deny") {
  process.stderr.write(`denied by ${event}\n`);
  process.exit(2);
} else if (action === "crash") {
  process.stderr.write(`crashed in ${event}\n`);
  process.exit(1);
} else if (action === "invalid-json") {
  process.stdout.write("not json\n");
} else if (action === "bad-schema") {
  process.stdout.write(`${JSON.stringify({ decision: "maybe" })}\n`);
} else if (action === "timeout") {
  await Bun.sleep(5000);
} else if (action === "failed-context") {
  process.stdout.write(
    JSON.stringify({ decision: "deny", additionalContext: "discard failed hook context" }),
  );
  process.exit(1);
} else if (action === "overflow") {
  process.stdout.write(`${JSON.stringify({ decision: "allow" })}${" ".repeat(70_000)}`);
} else if (action === "orphan" && process.env.FLECTEN_HOOK_MARK) {
  const child = Bun.spawn(["setsid", process.execPath, "-e", "await Bun.sleep(30_000)"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  appendFileSync(process.env.FLECTEN_HOOK_MARK, String(child.pid));
  process.exit(0);
}
