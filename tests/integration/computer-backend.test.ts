import { expect, test } from "bun:test";

const { DesktopBackend } = await import(
  new URL("../../src/marketplace/modules/computer-use/backend.mjs", import.meta.url).href
);
const programs = ["Xvfb", "xauth", "xdotool", "import", "dbus-daemon", "firefox", "python3"];
const supported = process.platform === "linux" && programs.every((program) => Bun.which(program));

interface Node {
  role: string;
  name: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

test.skipIf(!supported)(
  "private backend grounds real Firefox input, preserves UTF-8, verifies navigation and tears down",
  async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname + url.search);
        return new Response(
          '<!doctype html><html><title>Private desktop test</title><body style="background:#f8f8f8;font:28px sans-serif;padding:60px"><h1>Private desktop verification</h1><label for="text">Name</label><input id="text" aria-label="Name" autofocus oninput="fetch(\'/input?value=\'+encodeURIComponent(this.value))" style="font:28px sans-serif"><button style="font:28px sans-serif" onclick="fetch(\'/clicked\')">Count</button></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const backend = new DesktopBackend();
    try {
      await backend.start({ width: 1280, height: 800 }, AbortSignal.timeout(15000));
      await backend.launch({ url: server.url.href }, AbortSignal.timeout(20000));
      const observed = await backend.observe(AbortSignal.timeout(7000));
      expect(observed.width).toBe(1280);
      expect(observed.height).toBe(800);
      expect(observed.accessibility.available).toBe(true);
      const field = observed.accessibility.nodes.find(
        (node: Node) => node.role === "entry" && node.name === "Name",
      ) as Node | undefined;
      if (!field?.bounds)
        throw new Error("The real desktop did not expose the visible fixture input");
      await backend.act(
        { type: "click", x: field.bounds.x + 20, y: field.bounds.y + 15 },
        AbortSignal.timeout(3000),
      );
      await backend.act(
        { type: "type", text: "Перевірка Computer Use" },
        AbortSignal.timeout(8000),
      );
      await backend.act({ type: "key", keys: ["Tab"] }, AbortSignal.timeout(3000));
      await backend.act({ type: "key", keys: ["Return"] }, AbortSignal.timeout(3000));
      await backend.observe(AbortSignal.timeout(7000));
      expect(
        requests.some(
          (path) => path === `/input?value=${encodeURIComponent("Перевірка Computer Use")}`,
        ),
      ).toBe(true);
      expect(requests).toContain("/clicked");
      await backend.launch(
        { url: new URL("/second", server.url).href },
        AbortSignal.timeout(10000),
      );
      await backend.observe(AbortSignal.timeout(7000));
      expect(requests).toContain("/second");
      await expect(
        backend.act({ type: "click", x: 1280, y: 0 }, AbortSignal.timeout(1000)),
      ).rejects.toThrow("X coordinate");
      const cancelled = new AbortController();
      const wait = backend.act({ type: "wait", durationMs: 2000 }, cancelled.signal);
      cancelled.abort();
      await expect(wait).rejects.toThrow("cancelled");
    } finally {
      await backend.stop();
      server.stop(true);
    }
    expect(backend.status().ready).toBe(false);
  },
  45000,
);
