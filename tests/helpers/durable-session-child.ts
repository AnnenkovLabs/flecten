import { join } from "node:path";
import { SessionLogs } from "../../src/app/session-logs";
import { saveQueue } from "../../src/store/queue";
import { atomicWrite } from "../../src/util/atomic";

const cwd = process.argv[2];
if (!cwd) throw new Error("Expected an isolated test workspace");
const logs = new SessionLogs(cwd, () => []);
await saveQueue(cwd, "s_crash_first", {
  version: 1,
  items: [
    { id: "delivered", text: "first", mode: "queue", createdAt: 1, state: "sending" },
    { id: "pending", text: "next", mode: "queue", createdAt: 2, state: "sending" },
  ],
});
await logs.persist({
  type: "session.started",
  sessionId: "s_crash_first",
  prompt: "first conversation",
  provider: "test",
  model: "test",
  queueId: "delivered",
});
await logs.persist({
  type: "message.finished",
  sessionId: "s_crash_first",
  text: "acknowledged answer",
  reasoning: "",
  toolCalls: [],
});
await logs.persist({
  type: "session.started",
  sessionId: "s_crash_second",
  prompt: "second conversation",
  provider: "test",
  model: "test",
});
await atomicWrite(join(cwd, "settings.json"), '{"theme":"dark"}\n', 0o600);
process.stdout.write("ACK\n");
setInterval(() => {}, 1000);
