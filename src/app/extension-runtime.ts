import type { McpHttpServerConfig } from "../mcp/config";
import { McpElicitationBroker } from "../mcp/elicitation";
import { McpOAuthClient } from "../mcp/oauth-client";
import type { McpSessionRuntime } from "../mcp/session";
import { readSkillResource } from "../skills/resource";
import { listSkillResources } from "../skills/resources";
import type { AppExtensions } from "./extensions";
import { mcpSecretStore } from "./mcp-oauth";

export function extensionRuntime(
  cwd: string,
  current: () => AppExtensions,
  refresh: () => Promise<void>,
) {
  const elicitation = new McpElicitationBroker();
  const authorizations = new Map<string, McpOAuthClient>();
  const configurations = new Map<string, string>();
  const moduleRuntimes = new Set<McpSessionRuntime>();
  const runtime = (): McpSessionRuntime => {
    const mcp = current().mcp;
    if (!("reconnect" in mcp)) throw new Error("Сначала подтвердите доверие проекту");
    return mcp as McpSessionRuntime;
  };
  const reconnect = async (id?: string) => {
    const targets = id
      ? [...moduleRuntimes].filter((module) => module.statuses.some((status) => status.id === id))
      : [];
    if (targets.length) await Promise.all(targets.map((module) => module.reconnect(id)));
    else await runtime().reconnect(id);
    await refresh();
    return view();
  };
  function oauth(id: string, config: McpHttpServerConfig) {
    if (!config.oauth) return undefined;
    let provider = authorizations.get(id);
    const signature = JSON.stringify(config);
    if (!provider || configurations.get(id) !== signature) {
      provider?.cancel();
      provider = new McpOAuthClient(id, config, mcpSecretStore(cwd, config.url), async () => {
        await reconnect(id);
      });
      authorizations.set(id, provider);
      configurations.set(id, signature);
    }
    return provider;
  }
  function view() {
    const mcp = current().mcp;
    const live = "logs" in mcp ? (mcp as McpSessionRuntime) : undefined;
    return {
      servers: mcp.statuses,
      tools: mcp.tools.map(({ name, description }) => ({ name, description })),
      logs: live?.logs(undefined, 100) ?? [],
      catalogs: (mcp.catalogs ?? []).map(({ server, resourceItems, promptItems }) => ({
        server,
        resources: resourceItems,
        prompts: promptItems,
      })),
      elicitation: elicitation.pending(),
      authorizations: [...authorizations.values()].flatMap((provider) => {
        const status = provider.status();
        return status ? [status] : [];
      }),
    };
  }
  return {
    options: { elicitation, tokenProviderFor: oauth },
    registerRuntime(module: McpSessionRuntime) {
      moduleRuntimes.add(module);
      return () => {
        moduleRuntimes.delete(module);
      };
    },
    status: view,
    reconnect,
    async authorize(id: string) {
      const provider = authorizations.get(id);
      if (!provider) throw new Error("Сохраните HTTP сервер с OAuth перед авторизацией");
      return provider.start();
    },
    cancelAuthorization(id: string) {
      authorizations.get(id)?.cancel();
    },
    answer: (id: string, response: unknown) => elicitation.answer(id, response),
    resource: (server: string, uri: string) => runtime().attachResource(server, uri),
    prompt: (server: string, name: string, args?: Record<string, string>) =>
      runtime().invokePrompt(server, name, args),
    async skillResource(name: string, path: string) {
      const skill = current().skills.skills.find((entry) => entry.name === name);
      if (!skill) throw new Error("Навык не найден");
      return readSkillResource(skill, path);
    },
    async skills() {
      return Promise.all(
        current().skills.skills.map(async (skill) => ({
          ...skill,
          resources: await listSkillResources(skill.directory),
        })),
      );
    },
    close() {
      elicitation.close();
      for (const provider of authorizations.values()) provider.cancel();
    },
  };
}

export type ExtensionRuntime = ReturnType<typeof extensionRuntime>;
