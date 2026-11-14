import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createAppService } from "../../src/app/service";
import type { Event } from "../../src/core/types";
import { moduleFixture } from "../helpers/modules";

const fixtures: Awaited<ReturnType<typeof moduleFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

test("trust is resolved before a run and trusted directories stay trusted after reopening", async () => {
  const f = await moduleFixture();
  fixtures.push(f);
  expect(f.app.info()).toMatchObject({
    trustRequired: true,
    trustAccepted: false,
    trustState: "unknown",
  });
  await f.app.acceptTrust();
  f.script((_input, turn) =>
    turn === 0
      ? { name: "module", args: { operation: "activate", name: "studio" } }
      : "<complete>Ready.</complete>",
  );
  const events: Event[] = [];
  f.app.session.subscribe((event) => events.push(event));
  expect(
    await f.app.session.send({
      type: "run",
      sessionId: "trust-activation",
      prompt: "Use studio",
    }),
  ).toMatchObject({ stopReason: "done" });
  expect((await f.app.modules.state("trust-activation")).active.map((ref) => ref.name)).toEqual([
    "studio",
  ]);
  expect(JSON.stringify(f.requests.at(-1))).toContain("STUDIO_INSTRUCTIONS_V1");
  expect(events.filter((event) => event.type === "approval.requested")).toHaveLength(0);
  const reopened = await createAppService(f.cwd);
  try {
    expect(reopened.info()).toMatchObject({ trustAccepted: true, trustState: "trusted" });
  } finally {
    await reopened.dispose();
  }
});

test("an explicit refusal persists, keeps module code inactive and can be changed later", async () => {
  const f = await moduleFixture();
  fixtures.push(f);
  await f.app.rejectTrust();
  f.script((_input, turn) =>
    turn === 0
      ? { name: "module", args: { operation: "activate", name: "studio" } }
      : "<complete>Restricted.</complete>",
  );
  const events: Event[] = [];
  f.app.session.subscribe((event) => events.push(event));
  await f.app.session.send({
    type: "run",
    sessionId: "trust-denied",
    prompt: "Use studio",
  });
  expect(f.app.info()).toMatchObject({ trustAccepted: false, trustState: "untrusted" });
  expect((await f.app.modules.state("trust-denied")).active).toEqual([]);
  expect(events.filter((event) => event.type === "approval.requested")).toHaveLength(0);
  expect(JSON.stringify(f.requests)).not.toContain("STUDIO_INSTRUCTIONS_V1");
  const reopened = await createAppService(f.cwd);
  try {
    expect(reopened.info()).toMatchObject({ trustAccepted: false, trustState: "untrusted" });
    await reopened.acceptTrust();
    expect(reopened.info()).toMatchObject({ trustAccepted: true, trustState: "trusted" });
  } finally {
    await reopened.dispose();
  }
});
