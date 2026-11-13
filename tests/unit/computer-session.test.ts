import { expect, test } from "bun:test";
import { z } from "zod";

const { ComputerSession } = await import(
  new URL("../../src/marketplace/modules/computer-use/session.mjs", import.meta.url).href
);
const { computerSchemas } = await import(
  new URL("../../src/marketplace/modules/computer-use/schemas.mjs", import.meta.url).href
);

const signal = () => new AbortController().signal;
function fixture() {
  let actions = 0;
  let captures = 0;
  let stopped = false;
  let failCapture = false;
  const backend = {
    status: () => ({ backend: "fixture" }),
    start: async () => {},
    stop: async () => {
      stopped = true;
    },
    observe: async () => {
      captures++;
      if (failCapture) throw new Error("capture unavailable");
      return { width: 800, height: 600, image: { data: "cGl4ZWxz", mimeType: "image/png" } };
    },
    act: async (_action: unknown, _signal: AbortSignal) => {
      actions++;
    },
    launch: async () => {
      actions++;
    },
  };
  return {
    session: new ComputerSession(backend),
    backend,
    actions: () => actions,
    captures: () => captures,
    stopped: () => stopped,
    failCapture: () => {
      failCapture = true;
    },
  };
}

test("observations are consumed once, cached viewer reads preserve identity, handoff revokes input", async () => {
  const f = fixture();
  const s = f.session;
  await s.start({}, signal());
  const id = s.observation.id;
  await s.observe({ refresh: false }, signal());
  expect(s.observation.id).toBe(id);
  expect(f.captures()).toBe(1);
  await s.act(
    {
      observationId: id,
      reason: "Click the visible target",
      action: { type: "click", x: 2, y: 2 },
    },
    signal(),
  );
  expect(f.actions()).toBe(1);
  await expect(
    s.act({ observationId: id, action: { type: "click", x: 2, y: 2 } }, signal()),
  ).rejects.toThrow("stale");
  await s.changeControl("take_over", signal());
  await expect(
    s.act({ observationId: s.observation.id, action: { type: "wait", durationMs: 0 } }, signal()),
  ).rejects.toThrow("human has control");
  await s.act(
    { observationId: s.observation.id, action: { type: "wait", durationMs: 0 } },
    signal(),
    "human",
  );
  await s.changeControl("resume", signal());
  expect(s.snapshot()).toMatchObject({ state: "ready", control: "agent" });
  await s.changeControl("stop", signal());
  expect(f.stopped()).toBe(true);
  expect(s.observation).toBeNull();
});

test("fresh viewer previews preserve the agent's pending observation and share one capture", async () => {
  const f = fixture();
  await f.session.start({}, signal());
  const id = f.session.observation.id;
  const instanceId = f.session.snapshot().instanceId;
  const [first, second] = await Promise.all([
    f.session.preview(signal()),
    f.session.preview(signal()),
  ]);
  expect(first.instanceId).toBe(instanceId);
  expect(instanceId).toBeString();
  expect(first.preview.id).not.toBe(id);
  expect(second.preview.id).toBe(first.preview.id);
  expect(f.captures()).toBe(2);
  expect(f.session.observation.id).toBe(id);
  await expect(
    f.session.act(
      { observationId: first.preview.id, action: { type: "wait", durationMs: 0 } },
      signal(),
    ),
  ).rejects.toThrow("stale");
  expect(first.preview.image).toBeUndefined();
  expect(first.previewImage.data).toBe("cGl4ZWxz");
  await f.session.act({ observationId: id, action: { type: "wait", durationMs: 0 } }, signal());
  expect(f.actions()).toBe(1);
  expect(f.session.snapshot().preview).toBeNull();
  expect(first.previewImage.data).toBe("cGl4ZWxz");
});

test("starting a desktop does not report a browser navigation", async () => {
  const f = fixture();
  await f.session.start({}, signal());
  expect(f.session.snapshot().browserNavigation).toBe("not-requested");
  await f.session.navigate(
    { observationId: f.session.observation.id, url: "https://example.com", reason: "Open page" },
    signal(),
  );
  expect(f.session.snapshot().browserNavigation).toBe("dispatched");
  await f.session.changeControl("stop", signal());
  expect(f.session.snapshot().browserNavigation).toBe("not-requested");
});

test("human input and navigation can consume the latest visible preview", async () => {
  const f = fixture();
  await f.session.start({}, signal());
  await f.session.changeControl("take_over", signal());
  const canonicalId = f.session.observation.id;
  const preview = await f.session.preview(signal());
  expect(f.session.observation.id).toBe(canonicalId);
  await f.session.act(
    { observationId: preview.preview.id, action: { type: "click", x: 2, y: 2 } },
    signal(),
    "human",
  );
  expect(f.actions()).toBe(1);
  expect(f.session.snapshot().preview).toBeNull();
  expect(f.session.observation.id).not.toBe(canonicalId);
  const next = await f.session.preview(signal());
  await f.session.navigate(
    { observationId: next.preview.id, url: "https://example.com", reason: "Open visible page" },
    signal(),
    "human",
  );
  expect(f.actions()).toBe(2);
  expect(f.session.snapshot().preview).toBeNull();
  await expect(
    f.session.act(
      { observationId: next.preview.id, action: { type: "wait", durationMs: 0 } },
      signal(),
      "human",
    ),
  ).rejects.toThrow("stale");
});

test("failed post-action capture never replays delivered input and invalidates its observation", async () => {
  const f = fixture();
  await f.session.start({}, signal());
  const id = f.session.observation.id;
  f.failCapture();
  await expect(
    f.session.act({ observationId: id, action: { type: "key", keys: ["Return"] } }, signal()),
  ).rejects.toThrow("Action delivered");
  expect(f.actions()).toBe(1);
  expect(f.session.observation).toBeNull();
  await expect(
    f.session.act({ observationId: id, action: { type: "key", keys: ["Return"] } }, signal()),
  ).rejects.toThrow("stale");
  expect(f.actions()).toBe(1);
});

test("takeover cancels active input and invalidates queued agent actions before they execute", async () => {
  const f = fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.backend.act = async (_action: unknown, active: AbortSignal) => {
    entered();
    await new Promise<void>((_resolve, reject) =>
      active.addEventListener("abort", () => reject(active.reason), { once: true }),
    );
  };
  await f.session.start({}, signal());
  const id = f.session.observation.id;
  const input = f.session
    .act({ observationId: id, action: { type: "wait", durationMs: 2000 } }, signal())
    .catch((error: Error) => error);
  await started;
  const queued = f.session
    .act({ observationId: id, action: { type: "wait", durationMs: 0 } }, signal())
    .catch((error: Error) => error);
  await f.session.changeControl("take_over", signal());
  expect(await input).toBeInstanceOf(Error);
  expect(await queued).toBeInstanceOf(Error);
  expect(f.session.snapshot()).toMatchObject({ state: "human", control: "human" });
});

test("computer boundary rejects forged control metadata, arbitrary commands and unsafe input", () => {
  const schema = computerSchemas(z);
  expect(
    schema.act.safeParse({
      observationId: crypto.randomUUID(),
      reason: "test",
      action: { type: "shell", command: "echo unsafe" },
    }).success,
  ).toBe(false);
  expect(
    schema.control.safeParse({
      operation: "resume",
      _meta: { "flecten.dev/invocation-origin": "module-surface" },
    }).success,
  ).toBe(false);
  expect(
    schema.navigate.safeParse({
      observationId: crypto.randomUUID(),
      reason: "test",
      url: "file:///etc/passwd",
    }).success,
  ).toBe(false);
  expect(
    schema.act.safeParse({
      observationId: crypto.randomUUID(),
      reason: "test",
      action: { type: "click", x: -1, y: 0 },
    }).success,
  ).toBe(false);
});

test("accepted stop finishes cleanup even when its caller cancels and a later handoff is invalid", async () => {
  const f = fixture();
  await f.session.start({}, signal());
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.backend.act = async (_action: unknown, active: AbortSignal) => {
    entered();
    await new Promise<void>((_resolve, reject) => {
      active.addEventListener("abort", () => reject(active.reason), { once: true });
    });
  };
  const input = f.session
    .act(
      {
        observationId: f.session.observation.id,
        action: { type: "wait", durationMs: 2000 },
      },
      signal(),
    )
    .catch((error: Error) => error);
  await started;
  const caller = new AbortController();
  const stopped = f.session.changeControl("stop", caller.signal);
  caller.abort();
  await expect(f.session.changeControl("resume", signal())).rejects.toThrow("Start the desktop");
  await stopped;
  expect(await input).toBeInstanceOf(Error);
  expect(f.stopped()).toBe(true);
  expect(f.session.snapshot()).toMatchObject({ state: "stopped", observation: null });
});

test("explicit pre-delivery rejection is distinguished from uncertain input without retry", async () => {
  const f = fixture();
  await f.session.start({}, signal());
  f.backend.act = async () => {
    throw Object.assign(new Error("Coordinate outside the display"), { delivery: "not-delivered" });
  };
  await expect(
    f.session.act(
      { observationId: f.session.observation.id, action: { type: "click", x: 900, y: 2 } },
      signal(),
    ),
  ).rejects.toThrow("rejected before delivery");
  expect(f.actions()).toBe(0);
  expect(f.session.observation).toBeNull();
  expect(f.session.snapshot().history.at(-1)).toMatchObject({
    action: "click",
    status: "rejected",
  });
});
