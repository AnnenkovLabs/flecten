import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { readModule } from "../../src/modules/package";
import { waitFor } from "../helpers/hooks";
import { moduleFixture, runtimeVersion } from "../helpers/modules";

const fixtures: Awaited<ReturnType<typeof moduleFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
});
async function setup() {
  const f = await moduleFixture();
  fixtures.push(f);
  await f.app.acceptTrust();
  await f.app.modules.change({ operation: "development", path: f.root, enabled: true });
  return f;
}
const activate = { name: "module", args: { operation: "activate", name: "studio" } };
const measure = {
  name: "module",
  args: {
    operation: "call",
    name: "studio",
    tool: "mcp_module_studio__runtime_measure",
    arguments: { seconds: 2 },
  },
};

test("broken development code rolls back once, recovers on the next revision and survives reopen", async () => {
  const f = await setup();
  f.script((_input, turn) => (turn === 0 ? activate : "<complete>Ready.</complete>"));
  await f.app.session.send({ type: "run", sessionId: "rollback", prompt: "Use studio" });
  const initial = (await f.app.modules.state("rollback")).active[0]?.revision;
  await Bun.write(
    join(f.root, "runtime.mjs"),
    "export default () => { throw new Error('BAD_GENERATION') }",
  );
  await f.app.modules.runtime.catalog.refresh(true);
  f.script((_input, turn) => (turn === 2 ? measure : "<complete>Working.</complete>"));
  expect(
    await f.app.session.send({ type: "run", sessionId: "rollback", prompt: "Measure" }),
  ).toMatchObject({ stopReason: "done" });
  expect(JSON.stringify(f.requests.at(-1))).toContain("BAD_GENERATION");
  expect(JSON.stringify(f.requests.at(-1))).toContain('\\"version\\":\\"V1\\"');
  expect((await f.app.modules.state("rollback")).active[0]?.revision).toBe(initial);
  await runtimeVersion(f.root, "V3");
  await f.app.modules.runtime.catalog.refresh(true);
  await f.app.session.close("rollback");
  f.script((_input, turn) => (turn === 4 ? measure : "<complete>Recovered.</complete>"));
  await f.app.session.send({
    type: "run",
    sessionId: "rollback",
    prompt: "Continue after reopening",
  });
  expect(JSON.stringify(f.requests.at(-1))).toContain('\\"version\\":\\"V3\\"');
  expect((await f.app.modules.state("rollback")).active[0]?.revision).toBe(
    (await readModule(f.root)).revision,
  );
}, 15_000);

test("hot replacement preserves an in-flight UI call on the old immutable runtime", async () => {
  const f = await setup();
  f.manifest.surfaces[0]?.tools.push("mcp_module_studio__runtime_wait");
  await Bun.write(join(f.root, ".flecten-module/module.json"), JSON.stringify(f.manifest));
  await f.app.modules.runtime.catalog.refresh(true);
  f.script((_input, turn) => (turn === 0 ? activate : "<complete>Ready.</complete>"));
  await f.app.session.send({ type: "run", sessionId: "lease", prompt: "Open studio" });
  const surface = (await f.app.modules.state("lease")).surfaces[0];
  if (!surface) throw new Error("Missing surface");
  const handlers = createHandlers(f.app, () => undefined);
  const waiting = handlers["modules.invoke"]({
    type: "modules.invoke",
    sessionId: "lease",
    name: "studio",
    surface: "studio",
    revision: surface.revision,
    request: {
      type: "flecten.module.request",
      id: "wait",
      method: "call",
      tool: "mcp_module_studio__runtime_wait",
      arguments: {},
    },
  });
  await waitFor(() => Bun.file(join(f.cwd, "started")).exists());
  await runtimeVersion(f.root, "V2");
  await f.app.modules.runtime.catalog.refresh(true);
  f.script((_input, turn) => (turn === 2 ? measure : "<complete>Updated.</complete>"));
  await f.app.session.send({ type: "run", sessionId: "lease", prompt: "Use new version" });
  expect(JSON.stringify(f.requests.at(-1))).toContain('\\"version\\":\\"V2\\"');
  await Bun.write(join(f.cwd, "release"), "ready");
  expect(await waiting).toMatchObject({ moduleResult: { ok: true, output: "V1 released" } });
}, 15_000);

test("dependency activation is atomic, conflicts fail, and modules remain session scoped", async () => {
  const f = await setup();
  const dependency = join(f.cwd, ".agents/modules/guide");
  await mkdir(join(dependency, ".flecten-module"), { recursive: true });
  await Bun.write(
    join(dependency, ".flecten-module/module.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "guide",
      version: "1",
      description: "Guide only",
      instructions: ["guide.md"],
    }),
  );
  await Bun.write(join(dependency, "guide.md"), "DEPENDENCY_GUIDANCE");
  f.manifest.requires = ["guide"];
  await Bun.write(join(f.root, ".flecten-module/module.json"), JSON.stringify(f.manifest));
  await f.app.modules.runtime.catalog.refresh(true);
  await f.app.modules.change({
    operation: "trust",
    path: dependency,
    revision: (await readModule(dependency)).revision,
  });
  f.script((_input, turn) => (turn === 0 ? activate : "<complete>Ready.</complete>"));
  await f.app.session.send({ type: "run", sessionId: "graph", prompt: "Use studio" });
  expect((await f.app.modules.state("graph")).active.map((ref) => ref.name)).toEqual([
    "guide",
    "studio",
  ]);
  expect(JSON.stringify(f.requests.at(-1))).toContain("DEPENDENCY_GUIDANCE");
  expect((await f.app.modules.state("other")).active).toEqual([]);
  f.manifest.conflicts = ["guide"];
  await Bun.write(join(f.root, ".flecten-module/module.json"), JSON.stringify(f.manifest));
  await f.app.modules.runtime.catalog.refresh(true);
  f.script(() => "<complete>Unavailable.</complete>");
  await f.app.session.send({ type: "run", sessionId: "graph", prompt: "Continue" });
  expect((await f.app.modules.state("graph")).active).toEqual([]);
  expect(JSON.stringify(f.requests.at(-1))).toContain("Module conflict");
}, 15_000);
