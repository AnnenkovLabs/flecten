import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { readModule } from "../../src/modules/package";

export interface ProviderInput {
  messages: Array<{ role: string; content?: unknown }>;
  tools: unknown[];
}
export interface ScriptCall {
  name: string;
  args: unknown;
}
export async function moduleFixture(options: { conversation?: boolean } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-modules-"));
  const root = join(cwd, ".agents/modules/studio");
  const manifest = {
    schemaVersion: 1,
    name: "studio",
    version: "1.0.0",
    description: "Build trailers and storyboards",
    capabilities: ["video"],
    requires: [] as string[],
    conflicts: [] as string[],
    instructions: ["instructions.md"],
    resources: [{ id: "guide", path: "guide.md", description: "Trailer guide" }],
    runtime: { entry: "runtime.mjs" },
    surfaces: [
      {
        id: "studio",
        title: "Trailer studio",
        entry: "surface.html",
        tools: ["mcp_module_studio__runtime_measure"],
        resources: ["guide"],
      },
    ],
    hooks: {
      preToolUse: [
        {
          command: `${process.execPath} "$FLECTEN_MODULE_ROOT/hook.mjs"`,
          matcher: { tool: "read" },
          timeoutMs: 1000,
        },
      ],
    },
  };
  await mkdir(join(root, ".flecten-module"), { recursive: true });
  await Bun.write(join(root, ".flecten-module/module.json"), JSON.stringify(manifest));
  await Bun.write(
    join(root, "instructions.md"),
    "STUDIO_INSTRUCTIONS_V1: inspect timing before export.",
  );
  await Bun.write(
    join(root, "guide.md"),
    "STUDIO_GUIDE: establish a conflict and show visual proof.",
  );
  await Bun.write(
    join(root, "surface.html"),
    "<h1>Trailer studio</h1><button id='measure'>Measure</button><output></output><script>document.querySelector('button').onclick=async()=>{const r=await flecten.call('mcp_module_studio__runtime_measure',{seconds:12});document.querySelector('output').textContent=r.output}</script>",
  );
  await Bun.write(
    join(root, "hook.mjs"),
    "process.stdout.write(JSON.stringify({decision:'deny',reason:'STUDIO_HOOK_BLOCKED_READ'}));",
  );
  await runtimeVersion(root, "V1");
  const initial = await readModule(root);
  const requests: ProviderInput[] = [];
  let workerPage: "unstarted" | "active" | "completed" = "unstarted";
  let workerAnswer = "";
  let responses = 0;
  let handler: (
    input: ProviderInput,
    index: number,
  ) => ScriptCall | string | Promise<ScriptCall | string> = () => "<complete>Finished.</complete>";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const input = (await request.json()) as ProviderInput;
      const worker = ((input.tools ?? []) as Array<{ function?: { name?: string } }>).some(
        (tool) => tool.function?.name === "context",
      );
      let next: ScriptCall | string;
      if (!input.tools?.length) {
        next = JSON.stringify({
          progress: "The scripted module inspection is complete.",
          locations: "The active module and its verified tool results.",
          instructions: "Keep the user's module and permission constraints.",
          nextSteps: "Report the verified module result.",
          risks: "Failures remain recorded in the tool results.",
        });
      } else if (worker && workerPage === "unstarted") {
        workerPage = "active";
        next = {
          name: "context",
          args: {
            op: "begin",
            title: "Module inspection",
            objective: "Verify the requested module behavior.",
          },
        };
      } else if (worker && workerPage === "completed") {
        next = workerAnswer;
      } else {
        requests.push(input);
        next = await handler(input, requests.length - 1);
        if (worker && typeof next === "string") {
          workerAnswer = next;
          workerPage = "completed";
          next = {
            name: "context",
            args: {
              op: "complete",
              summary: "The requested module inspection is complete.",
              evidence: ["The module calls returned their actual verified results."],
              next: "Report the module results and any observed failures.",
            },
          };
        }
      }
      responses += 1;
      const delta =
        typeof next === "string"
          ? { content: next }
          : {
              tool_calls: [
                {
                  index: 0,
                  id: `call-${responses}`,
                  type: "function",
                  function: { name: next.name, arguments: JSON.stringify(next.args) },
                },
              ],
            };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason: typeof next === "string" ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const config = {
    useDefaults: false,
    provider: "test",
    model: "test",
    catalog: { autoRefresh: false },
    skills: { sources: [] },
    providers: {
      test: {
        protocol: "openai-chat",
        baseUrl: server.url.href,
        models: { test: { context: 128000, output: 8192, reasoning: false, vision: true } },
      },
    },
    modules: { dirs: [root], trusted: { [root]: initial.revision } },
    permissions: {
      skill: "allow",
      mcp: "allow",
      read: "allow",
      rules: options.conversation ? [{ action: "write", tool: "worker", policy: "allow" }] : [],
    },
    checkpoints: { shell: false },
    loop: { maxTurns: 16 },
    conversation: { enabled: options.conversation ?? false },
  };
  await Bun.write(join(cwd, "flecten.config.json"), JSON.stringify(config));
  const app = await createAppService(cwd);
  return {
    cwd,
    root,
    manifest,
    app,
    requests,
    server,
    config,
    script(next: typeof handler) {
      handler = next;
    },
    async close() {
      await app.dispose();
      server.stop(true);
    },
  };
}

export async function runtimeVersion(root: string, version: string): Promise<void> {
  await Bun.write(
    join(root, "runtime.mjs"),
    `export default ({server,z,workspace,moduleRoot})=>{
    server.registerTool('measure',{description:'Measure trailer duration',inputSchema:z.object({seconds:z.number().positive()})},async({seconds})=>({content:[{type:'text',text:JSON.stringify({version:'${version}',frames:seconds*24})}]}));
    server.registerTool('wait',{description:'Wait for a release marker',inputSchema:z.object({})},async()=>{await Bun.write(workspace+'/started','${version}');while(!(await Bun.file(workspace+'/release').exists()))await new Promise(r=>setTimeout(r,5));return{content:[{type:'text',text:'${version} released'}]}});
    server.registerTool('screenshot',{description:'Return a test screen image',inputSchema:z.object({})},async()=>({content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII='}]}));
  };`,
  );
}
