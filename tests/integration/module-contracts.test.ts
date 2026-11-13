import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readModule } from "../../src/modules/package";
import { waitFor } from "../helpers/hooks";
import { moduleFixture } from "../helpers/modules";
import { type PlatformFixture, platform } from "../helpers/platform-modules";

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
});
async function fixture() {
  const f = await moduleFixture();
  fixtures.push(f);
  await f.app.acceptTrust();
  return f;
}
const activate = { name: "module", args: { operation: "activate", name: "studio" } };
const complete = "<complete>Ready.</complete>";

test("delegating model and agent wrappers cannot rewrite the cacheable request prefix", async () => {
  const f = await fixture();
  await platform(
    f,
    `export default ({services,contracts}) => services.wrap(contracts.model,next=>async(request,signal,provider)=>next({...request, system:'changed system'},signal,provider));`,
    "project",
  );
  expect(
    await f.app.session.send({ type: "run", sessionId: "model-prefix", prompt: "Original prompt" }),
  ).toMatchObject({
    stopReason: "error",
    summary: expect.stringContaining("preserve the cacheable"),
  });
  expect(f.requests).toHaveLength(0);
  await platform(
    f,
    `export default ({services,contracts}) => services.wrap(contracts.agent,next=>async(prompt,options)=>{ options.system = 'changed system'; return next(prompt,options); });`,
  );
  f.script((_input, turn) => (turn === 0 ? activate : complete));
  await f.app.session.send({ type: "run", sessionId: "agent-prefix", prompt: "Enable" });
  const before = f.requests.length;
  expect(
    await f.app.session.send({ type: "run", sessionId: "agent-prefix", prompt: "Original prompt" }),
  ).toMatchObject({ stopReason: "error", summary: expect.stringContaining("preserve the system") });
  expect(f.requests).toHaveLength(before);
}, 15_000);

test("missing or incompatible custom contracts reject activation atomically; malformed model streams stop the session", async () => {
  const f = await fixture();
  await platform(
    f,
    `export default ({services,defineService,z,contracts}) => { services.require(defineService('missing@1',z.string(),z.number())); services.replace(contracts.model,async()=>{throw new Error('MUST_NOT_COMMIT')}); };`,
  );
  f.script((_input, turn) => (turn === 0 ? activate : complete));
  await f.app.session.send({ type: "run", sessionId: "missing", prompt: "Enable invalid module" });
  await f.app.session.flush();
  expect((await f.app.modules.state("missing")).active).toEqual([]);
  expect(
    (await f.app.readSession("missing")).find((e) => e.type === "tool.finished"),
  ).toMatchObject({
    result: {
      ok: false,
      error: expect.stringContaining("Missing or incompatible service missing@1"),
    },
  });
  await platform(
    f,
    `export default ({services,defineService,z}) => { services.provide(defineService('same@1',z.string(),z.number()),async()=>1); services.require(defineService('same@1',z.number(),z.number())); };`,
  );
  f.script((_input, turn) => (turn === 2 ? activate : complete));
  await f.app.session.send({
    type: "run",
    sessionId: "mismatch",
    prompt: "Enable incompatible module",
  });
  expect((await f.app.modules.state("mismatch")).active).toEqual([]);
  await platform(
    f,
    `export default ({services,contracts}) => services.replace(contracts.model,async()=> (async function*(){yield {type:'usage',input:'bad',output:0,cached:0};})());`,
    "project",
  );
  expect(
    await f.app.session.send({
      type: "run",
      sessionId: "malformed",
      prompt: "Validate native stream",
    }),
  ).toMatchObject({ stopReason: "error" });
}, 15_000);

test("abort during asynchronous activation cleans late effects; aborted streams finish promptly and retire their resources", async () => {
  const f = await fixture();
  await platform(
    f,
    `export default async ({workspace,effect}) => { await effect(async()=>{await Bun.write(workspace+'/setup-started','yes');while(!(await Bun.file(workspace+'/setup-release').exists()))await new Promise(r=>setTimeout(r,5)); return ()=>Bun.write(workspace+'/late-cleanup','yes').then(()=>{});}); };`,
  );
  f.script(() => activate);
  const activation = f.app.session.send({
    type: "run",
    sessionId: "cancel-setup",
    prompt: "Enable",
  });
  await waitFor(() => Bun.file(join(f.cwd, "setup-started")).exists());
  await f.app.session.send({ type: "stop", sessionId: "cancel-setup", mode: "force" });
  expect(await activation).toMatchObject({ stopReason: "stopped" });
  await Bun.write(join(f.cwd, "setup-release"), "yes");
  await waitFor(() => Bun.file(join(f.cwd, "late-cleanup")).exists());
  expect((await f.app.modules.state("cancel-setup")).services).toEqual([]);
  await platform(
    f,
    `export default ({services,contracts,workspace}) => services.replace(contracts.model,async()=> (async function*(){yield {type:'text',delta:'partial'}; await Bun.write(workspace+'/stream-started','yes'); while(!(await Bun.file(workspace+'/stream-release').exists()))await new Promise(r=>setTimeout(r,5)); yield {type:'done',reason:'end'};})());`,
    "project",
  );
  const stream = f.app.session.send({ type: "run", sessionId: "cancel-stream", prompt: "Wait" });
  await waitFor(() => Bun.file(join(f.cwd, "stream-started")).exists());
  await f.app.session.send({ type: "stop", sessionId: "cancel-stream", mode: "force" });
  expect(await stream).toMatchObject({ stopReason: "stopped" });
  await Bun.write(join(f.cwd, "stream-release"), "yes");
}, 15_000);

test("nested module services use the same leased generation during hot reload; revoked dependencies remove dependents", async () => {
  const f = await fixture();
  const root = join(f.cwd, ".agents/modules/helper");
  await mkdir(join(root, ".flecten-module"), { recursive: true });
  await Bun.write(
    join(root, ".flecten-module/module.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "helper",
      version: "1",
      description: "Service dependency",
      platform: { entry: "platform.mjs", scope: "project" },
    }),
  );
  const helper = (version: string) =>
    `export default async ({services,defineService,z,effect,workspace}) => { await effect(()=>()=>Bun.write(workspace+'/helper-closed-${version}','yes').then(()=>{})); services.provide(defineService('helper@1',z.string(),z.string()),async()=> '${version}'); };`;
  await Bun.write(join(root, "platform.mjs"), helper("V1"));
  await f.app.modules.change({
    operation: "trust",
    path: root,
    revision: (await readModule(root)).revision,
  });
  await f.app.modules.change({ operation: "development", path: root, enabled: true });
  f.manifest.requires = ["helper"];
  await platform(
    f,
    `export default ({services,contracts,defineService,z,workspace}) => { const get = services.require(defineService('helper@1',z.string(),z.string())); services.replace(contracts.model,async(_request,signal)=> (async function*(){await Bun.write(workspace+'/nested-started','yes'); while(!(await Bun.file(workspace+'/nested-release').exists())){signal.throwIfAborted();await new Promise(r=>setTimeout(r,5));}yield {type:'text',delta:'<complete>'+await get('x',signal)+'</complete>'};yield {type:'done',reason:'end'};})()); };`,
    "project",
  );
  const running = f.app.session.send({
    type: "run",
    sessionId: "nested",
    prompt: "Use dependency",
  });
  await waitFor(() => Bun.file(join(f.cwd, "nested-started")).exists());
  await Bun.write(join(root, "platform.mjs"), helper("V2"));
  await f.app.modules.runtime.catalog.refresh(true);
  await f.app.modules.state();
  expect(await Bun.file(join(f.cwd, "helper-closed-V1")).exists()).toBe(false);
  await Bun.write(join(f.cwd, "nested-release"), "yes");
  expect(await running).toMatchObject({ summary: "V1" });
  await waitFor(() => Bun.file(join(f.cwd, "helper-closed-V1")).exists());
  expect(
    await f.app.session.send({ type: "run", sessionId: "nested2", prompt: "Use new dependency" }),
  ).toMatchObject({ summary: "V2" });
  await f.app.modules.change({ operation: "enable", path: root, enabled: false });
  expect((await f.app.modules.state()).services).toEqual([]);
}, 15_000);
