import { asciiAlphaNumeric } from "./formats";
import type { SecretVault } from "./vault";

const REFERENCE_TOOLS = new Set(["task", "worker", "memory", "context", "todo", "ask", "done"]);
const DATA_TOOLS = new Set(["edit", "write", "apply_patch", "read", "glob", "grep"]);
const EXECUTION_CHARACTERS = "_-./:@%+=,";

function executableSecret(secret: string): string {
  for (const char of secret) {
    if (!asciiAlphaNumeric(char) && !EXECUTION_CHARACTERS.includes(char)) {
      throw new Error(
        "Provider protection cannot restore this secret into an executable or external tool argument. Use an env/file or an encoded representation instead.",
      );
    }
  }
  return secret;
}

/** Accepts the registry's canonical tool name, never an inferred alias. */
export function restoreToolArguments<T>(vault: SecretVault, name: string, args: T): T {
  if (REFERENCE_TOOLS.has(name)) return vault.restore(args, (_secret, tag) => tag);
  if (DATA_TOOLS.has(name)) return vault.restore(args);
  // ponytail: only shell-literal-safe secret bytes enter execution/external arguments. A future
  // typed argv/env capability can carry arbitrary bytes without interpreting shell source.
  return vault.restore(args, executableSecret);
}
