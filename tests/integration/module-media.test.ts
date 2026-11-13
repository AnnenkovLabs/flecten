import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { moduleFixture } from "../helpers/modules";

test("module screenshot reaches the model as media and reopens without base64 in the durable transcript", async () => {
  const f = await moduleFixture();
  try {
    await f.app.acceptTrust();
    f.script((_input, turn) => {
      if (turn === 0) return { name: "module", args: { operation: "activate", name: "studio" } };
      if (turn === 1)
        return {
          name: "module",
          args: {
            operation: "call",
            name: "studio",
            tool: "mcp_module_studio__runtime_screenshot",
            arguments: {},
          },
        };
      return "<complete>Screen inspected.</complete>";
    });
    await f.app.session.send({ type: "run", sessionId: "vision", prompt: "Inspect screen" });
    const last = JSON.stringify(f.requests.at(-1));
    expect(last).toContain('"type":"image_url"');
    expect(last).toContain("data:image/png;base64,iVBORw0KGgo");
    const events = await f.app.readSession("vision");
    expect(JSON.stringify(events)).not.toContain("iVBORw0KGgo");
    expect(
      events.some((event) => event.type === "notice.applied" && event.attachments?.length === 1),
    ).toBe(true);
    await f.app.session.close("vision");
    f.script(() => "<complete>Resumed.</complete>");
    await f.app.session.send({ type: "run", sessionId: "vision", prompt: "Continue" });
    expect(JSON.stringify(f.requests.at(-1))).toContain("data:image/png;base64,iVBORw0KGgo");
  } finally {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
}, 15_000);
