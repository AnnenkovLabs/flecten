import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../helpers/hooks";
import { moduleFixture } from "../helpers/modules";
import { installExample, type PlatformFixture, platform } from "../helpers/platform-modules";

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
const activate = (name = "studio") => ({ name: "module", args: { operation: "activate", name } });

test("session platform replaces the model and wraps real guarded tools and compaction without changing the cached prefix", async () => {
  const f = await fixture();
  const hash = f.app.info().system.hash;
  await platform(
    f,
    `export default ({ services, contracts, workspace }) => {
    let turn = 0;
    services.replace(contracts.model, async (_request, signal) => (async function* () {
      signal.throwIfAborted();
      if (turn++ === 0) { yield { type:'tool_call', id:'native-read', name:'read', args:{path:'proof.txt'} }; yield {type:'done',reason:'tool_use'}; }
      else { yield {type:'text',delta:'<complete>Native provider finished.</complete>'}; yield {type:'usage', input:11,output:7,cached:3}; yield {type:'done',reason:'end'}; }
    })());
    services.wrap(contracts.tool, next => async (tool,input,context) => {
      const result = await next(tool,input,context);
      if (tool.name !== 'read') return result;
      await Bun.write(workspace+'/tool-ran-'+context.sessionId,'yes');
      return {...result, output:result.output+' TOOL_WRAPPED'};
    });
    services.wrap(contracts.compact, next => async (messages,options) => {
      await Bun.write(workspace+'/compact-ran','yes'); return next(messages,options);
    });
  }`,
  );
  await Bun.write(join(f.cwd, "proof.txt"), "A real workspace file");
  f.script(() => activate());
  const prompt = "  Make a trailer\nKeep these exact spaces.  ";
  const result = await f.app.session.send({ type: "run", sessionId: "native", prompt });
  expect(result).toMatchObject({ stopReason: "done", usage: { input: 11, output: 7, cached: 3 } });
  expect(f.requests).toHaveLength(1);
  expect(await Bun.file(join(f.cwd, "compact-ran")).exists()).toBe(true);
  await f.app.session.flush();
  const saved = await f.app.readSession("native");
  expect(saved.find((e) => e.type === "session.started")).toMatchObject({ prompt });
  expect(saved.find((e) => e.type === "tool.finished" && e.call.name === "read")).toMatchObject({
    result: { ok: true, output: expect.stringContaining("TOOL_WRAPPED") },
  });
  expect((await f.app.modules.state("native")).services).toContainEqual({
    owner: "studio",
    service: "harness.model@1",
    mode: "replace",
  });
  expect((await f.app.modules.state("other")).services).toEqual([]);
  f.script(() => "<complete>Ordinary provider.</complete>");
  await f.app.session.send({ type: "run", sessionId: "other", prompt: "Independent chat" });
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]?.tools).toEqual(f.requests[0]?.tools);
  expect(f.app.info().system.hash).toBe(hash);
  const config = f.app.settings().config;
  config.permissions = {
    ...config.permissions,
    rules: [{ action: "read", policy: "deny" }],
  } as NonNullable<typeof config.permissions>;
  await f.app.saveSettings({ config });
  f.script(() => activate());
  await f.app.session.send({ type: "run", sessionId: "denied", prompt: "Try reading" });
  await f.app.session.flush();
  expect(await Bun.file(join(f.cwd, "tool-ran-denied")).exists()).toBe(false);
  expect(
    (await f.app.readSession("denied")).find(
      (e) => e.type === "tool.finished" && e.call.name === "read",
    ),
  ).toMatchObject({ result: { ok: false, data: { kind: "permission" } } });
}, 20_000);

test("project stream reload retains old source/effects until completion, rolls back failures and revokes trust", async () => {
  const f = await fixture();
  const code = (
    version: string,
  ) => `export default async ({services,contracts,effect,workspace,moduleRoot,signal}) => {
    await effect(() => () => Bun.write(workspace+'/closed-${version}',String(signal.aborted)).then(()=>{}));
    services.replace(contracts.model, async (_request,abort) => (async function* () {
      yield {type:'text',delta:'<complete>'};
      await Bun.write(workspace+'/started-${version}',moduleRoot);
      if ('${version}' === 'V1') while (!(await Bun.file(workspace+'/release').exists())) { abort.throwIfAborted(); await new Promise(r=>setTimeout(r,5)); }
      const source = await Bun.file(moduleRoot+'/platform.mjs').text();
      yield {type:'text',delta:source.includes('closed-${version}') ? '${version}</complete>' : 'wrong</complete>'};
      yield {type:'done',reason:'end'};
    })());
  }`;
  await platform(f, code("V1"), "project");
  await f.app.modules.change({ operation: "development", path: f.root, enabled: true });
  const run = f.app.session.send({ type: "run", sessionId: "stream", prompt: "Use platform" });
  await waitFor(() => Bun.file(join(f.cwd, "started-V1")).exists());
  const oldRoot = await Bun.file(join(f.cwd, "started-V1")).text();
  await Bun.write(join(f.root, "platform.mjs"), code("V2"));
  await f.app.modules.runtime.catalog.refresh(true);
  await f.app.modules.state();
  expect(await Bun.file(join(f.cwd, "closed-V1")).exists()).toBe(false);
  expect(await Bun.file(join(oldRoot, "platform.mjs")).exists()).toBe(true);
  await Bun.write(join(f.cwd, "release"), "yes");
  expect(await run).toMatchObject({ summary: "V1" });
  await waitFor(() => Bun.file(join(f.cwd, "closed-V1")).exists());
  await waitFor(async () => !(await Bun.file(join(oldRoot, "platform.mjs")).exists()));
  expect(await Bun.file(join(f.cwd, "closed-V1")).text()).toBe("true");
  expect(
    await f.app.session.send({ type: "run", sessionId: "new", prompt: "Use new version" }),
  ).toMatchObject({ summary: "V2" });
  await Bun.write(
    join(f.root, "platform.mjs"),
    "export default ()=>{throw new Error('PLATFORM_FAILED')}",
  );
  await f.app.modules.runtime.catalog.refresh(true);
  expect((await f.app.modules.state()).errors).toContainEqual({
    path: "project services",
    message: "PLATFORM_FAILED",
  });
  expect(
    await f.app.session.send({ type: "run", sessionId: "rollback", prompt: "Retained version" }),
  ).toMatchObject({ summary: "V2" });
  await f.app.modules.change({ operation: "enable", path: f.root, enabled: false });
  expect((await f.app.modules.state()).services).toEqual([]);
  expect(await Bun.file(join(f.cwd, "closed-V2")).exists()).toBe(true);
  expect(f.requests).toHaveLength(0);
}, 20_000);

test("published examples replace the agent driver and communicate through schema-checked services, including replay", async () => {
  const f = await fixture();
  await installExample(f, "frame-service");
  await installExample(f, "frame-workflow");
  await Bun.write(join(f.cwd, "trailer-brief.json"), JSON.stringify({ seconds: 2, fps: 24 }));
  f.script((_input, turn) =>
    turn === 0 ? activate("frame-workflow") : "<complete>Ready.</complete>",
  );
  await f.app.session.send({ type: "run", sessionId: "workflow", prompt: "Enable frame workflow" });
  const before = f.requests.length;
  const prompt = "Compute timing from the local brief";
  expect(await f.app.session.send({ type: "run", sessionId: "workflow", prompt })).toMatchObject({
    stopReason: "done",
    summary: "2s at 24 fps: 48 frames.",
  });
  expect(f.requests).toHaveLength(before);
  await f.app.session.flush();
  const history = structuredClone(f.app.session.getHistory());
  expect(history.at(-1)).toMatchObject({ role: "assistant", content: "2s at 24 fps: 48 frames." });
  await f.app.session.close("workflow");
  await f.app.session.send({ type: "run", sessionId: "workflow", prompt: "Again" });
  const restored = f.app.session.getHistory().slice(0, history.length);
  expect(restored.at(-2)).toMatchObject({ role: "user", content: prompt, memorySource: prompt });
  expect(restored.at(-1)).toMatchObject({
    role: "assistant",
    content: "<summary>2s at 24 fps: 48 frames.</summary>",
  });
  expect(
    (await f.app.readSession("workflow")).filter((e) => e.type === "message.finished").at(-1),
  ).toMatchObject({ text: "2s at 24 fps: 48 frames." });
  const provider = (await f.app.modules.state()).modules.find((m) => m.name === "frame-service");
  if (!provider) throw new Error("Missing provider module");
  await f.app.modules.change({ operation: "enable", path: provider.path, enabled: false });
  f.script(() => "<complete>Ordinary driver restored.</complete>");
  expect(
    await f.app.session.send({
      type: "run",
      sessionId: "workflow",
      prompt: "After dependency removal",
    }),
  ).toMatchObject({ summary: "Ordinary driver restored." });
  expect((await f.app.modules.state("workflow")).active).toEqual([]);
}, 20_000);
