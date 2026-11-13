import { createHash } from "node:crypto";
import { loadSecrets, saveSecrets } from "../config/secrets";
import type { McpSecureStore } from "../mcp/oauth";

const projectWrites = new Map<string, Promise<unknown>>();

/** The existing secret backend owns encryption, file permissions and fallback policy. */
export function mcpSecretStore(cwd: string, resource: string): McpSecureStore {
  const scope = createHash("sha256").update(`${cwd}\0${resource}`).digest("hex").slice(0, 32);
  const keyOf = (key: string) => `mcp.${scope}.${key}`;
  const mutate = (key: string, value?: string): Promise<void> => {
    const task = (projectWrites.get(cwd) ?? Promise.resolve()).then(async () => {
      const name = keyOf(key);
      const secrets = await loadSecrets(cwd);
      if (value === undefined) delete secrets[name];
      else secrets[name] = value;
      await saveSecrets(cwd, secrets, value === undefined ? { deletes: [name] } : {});
    });
    projectWrites.set(
      cwd,
      task.catch(() => undefined),
    );
    return task;
  };
  return {
    async get(key) {
      await projectWrites.get(cwd);
      return (await loadSecrets(cwd, [keyOf(key)]))[keyOf(key)];
    },
    set: (key, value) => mutate(key, value),
    delete: (key) => mutate(key),
  };
}
