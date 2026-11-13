import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { Event } from "../../src/core/types";
import { moduleFixture } from "../helpers/modules";

const fixtures: Awaited<ReturnType<typeof moduleFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("untrusted project activation asks on screen and continues the same tool call after acceptance", async () => {
  const f = await moduleFixture();
  fixtures.push(f);
  expect(f.app.info().trustAccepted).toBe(false);
  f.script((_input, turn) =>
    turn === 0
      ? { name: "module", args: { operation: "activate", name: "studio" } }
      : "<complete>Ready.</complete>",
  );
  const events: Event[] = [];
  const requested = Promise.withResolvers<Extract<Event, { type: "approval.requested" }>>();
  f.app.session.subscribe((event) => {
    events.push(event);
    if (event.type === "approval.requested") requested.resolve(event);
  });
  const running = f.app.session.send({
    type: "run",
    sessionId: "trust-activation",
    prompt: "Use studio",
  });
  const first = await Promise.race([requested.promise, running.then(() => undefined)]);
  expect(first?.approval.risks?.some((risk) => risk.id === "project-trust")).toBe(true);
  if (!first) return;
  expect(first.approval.humanOnly).toBe(true);
  expect(first.approval.callId).toBe("call-1");
  expect(f.requests).toHaveLength(1);
  expect((await f.app.modules.state("trust-activation")).active).toEqual([]);
  await f.app.session.send({
    type: "approval.respond",
    id: first.approval.id,
    decision: "allow_once",
  });
  expect(await running).toMatchObject({ stopReason: "done" });
  expect(f.app.info().trustAccepted).toBe(true);
  expect((await f.app.modules.state("trust-activation")).active.map((ref) => ref.name)).toEqual([
    "studio",
  ]);
  expect(JSON.stringify(f.requests.at(-1))).toContain("STUDIO_INSTRUCTIONS_V1");
  expect(events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
});

for (const answer of ["deny", "stop"] as const) {
  test(`project trust ${answer} leaves module code inactive`, async () => {
    const f = await moduleFixture();
    fixtures.push(f);
    f.script((_input, turn) =>
      turn === 0
        ? { name: "module", args: { operation: "activate", name: "studio" } }
        : "<complete>Cancelled.</complete>",
    );
    const requested = Promise.withResolvers<Extract<Event, { type: "approval.requested" }>>();
    f.app.session.subscribe((event) => {
      if (event.type === "approval.requested") requested.resolve(event);
    });
    const running = f.app.session.send({
      type: "run",
      sessionId: "trust-denied",
      prompt: "Use studio",
    });
    const first = await Promise.race([requested.promise, running.then(() => undefined)]);
    expect(first).toBeDefined();
    if (!first) return;
    if (answer === "deny")
      await f.app.session.send({
        type: "approval.respond",
        id: first.approval.id,
        decision: "deny",
      });
    else await f.app.session.send({ type: "stop" });
    await running;
    expect(f.app.info().trustAccepted).toBe(false);
    expect((await f.app.modules.state("trust-denied")).active).toEqual([]);
    expect(f.app.session.peek().approvals).toBe(0);
    expect(JSON.stringify(f.requests)).not.toContain("STUDIO_INSTRUCTIONS_V1");
  });
}
