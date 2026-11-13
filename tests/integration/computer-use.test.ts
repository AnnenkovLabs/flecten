import { expect, test } from "bun:test";
import { cp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResult } from "../../src/core/types";
import { readModule } from "../../src/modules/package";
import { moduleFixture } from "../helpers/modules";

const packageRoot = join(import.meta.dir, "../../src/marketplace/modules/computer-use");
const prefix = "mcp_module_computer-use__runtime_";

async function logContents(directory: string): Promise<string> {
  let text = "";
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) text += await logContents(path);
    else if (entry.name.endsWith(".log") || entry.name.endsWith(".jsonl"))
      text += await readFile(path, "utf8");
  }
  return text;
}

test("Computer module delivers real media through the model and guarded surface, enforces human ownership and keeps pixels out of logs", async () => {
  if (
    process.platform !== "linux" ||
    !Bun.which("Xvfb") ||
    !Bun.which("xdotool") ||
    !Bun.which("xauth") ||
    !Bun.which("import") ||
    !Bun.which("dbus-daemon")
  )
    return;
  const f = await moduleFixture();
  try {
    await cp(packageRoot, f.root, { recursive: true });
    const source = await readModule(f.root);
    await f.app.acceptTrust();
    await f.app.modules.change({ operation: "trust", path: f.root, revision: source.revision });
    f.script((_input, turn) => {
      if (turn === 0)
        return { name: "module", args: { operation: "activate", name: "computer-use" } };
      if (turn === 1)
        return {
          name: "module",
          args: {
            operation: "call",
            name: "computer-use",
            tool: `${prefix}start`,
            arguments: { width: 800, height: 600 },
          },
        };
      if (turn === 2)
        return {
          name: "module",
          args: {
            operation: "call",
            name: "computer-use",
            tool: `${prefix}control`,
            arguments: { operation: "take_over" },
          },
        };
      return "<complete>Screen inspected.</complete>";
    });
    await f.app.session.send({
      type: "run",
      sessionId: "computer",
      prompt: "Inspect the private desktop",
    });
    expect(JSON.stringify(f.requests.at(-1))).toContain("data:image/png;base64,iVBORw0KGgo");
    const events = await f.app.readSession("computer");
    expect(JSON.stringify(events)).toContain("reserved for the human");
    const invoke = async (name: string, args: Record<string, unknown> = {}) =>
      (await f.app.session.send({
        type: "modules.invoke",
        sessionId: "computer",
        input: {
          name: "computer-use",
          surface: "desktop",
          revision: source.revision,
          request: {
            type: "flecten.module.request",
            id: crypto.randomUUID(),
            method: "call",
            tool: `${prefix}${name}`,
            arguments: args,
          },
        },
      })) as ToolResult & { media?: Array<{ data: string; mediaType: string }> };
    const status = await invoke("status");
    expect(status.ok).toBe(true);
    expect(status.data).toMatchObject({
      structuredContent: {
        state: "ready",
        control: "agent",
        observation: { width: 800, height: 600 },
      },
    });
    const cached = await invoke("observe", { refresh: false });
    expect(cached.media?.[0]?.mediaType).toBe("image/png");
    expect(cached.media?.[0]?.data).toStartWith("iVBORw0KGgo");
    expect(cached.attachments).toHaveLength(1);
    const beforePreview = (cached.data as { structuredContent: { observation: { id: string } } })
      .structuredContent.observation.id;
    const preview = await invoke("preview");
    expect(preview.ok).toBe(true);
    expect(preview.media?.[0]?.mediaType).toBe("image/png");
    expect(preview.data).toMatchObject({
      structuredContent: {
        observation: { id: beforePreview },
        preview: { id: expect.any(String) },
      },
    });
    expect(JSON.stringify(preview.data)).not.toContain("iVBORw0KGgo");
    const handed = await invoke("control", { operation: "take_over" });
    expect(handed.ok).toBe(true);
    expect(handed.data).toMatchObject({ structuredContent: { state: "human", control: "human" } });
    const manual = await invoke("interact", {
      observationId: (handed.data as { structuredContent: { observation: { id: string } } })
        .structuredContent.observation.id,
      reason: "Wait for the human view",
      action: { type: "wait", durationMs: 0 },
    });
    expect(manual.ok).toBe(true);
    const stopped = await invoke("control", { operation: "stop" });
    expect(stopped.data).toMatchObject({
      structuredContent: { state: "stopped", observation: null },
    });
    const logs = await logContents(join(f.cwd, ".liquid/sessions/computer"));
    expect(logs).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(await f.app.readSession("computer"))).not.toContain("iVBORw0KGgo");
  } finally {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
}, 30000);
