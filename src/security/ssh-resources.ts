import { programName, type ShellWord } from "./shell-lexer";

const VALUE_OPTIONS = new Set("BbcDEeFIiJLlmOopQRSWw");
const FILE_OPTIONS = new Set(["E", "F", "I", "i", "S"]);
const FILE_SETTINGS = new Set([
  "certificatefile",
  "controlpath",
  "globalknownhostsfile",
  "identityagent",
  "identityfile",
  "pkcs11provider",
  "revokedhostkeys",
  "securitykeyprovider",
  "userknownhostsfile",
  "xauthlocation",
]);
const COMMAND_SETTINGS = new Set(["proxycommand", "localcommand", "knownhostscommand"]);

export type SshResources = { destination?: string; files: string[]; commands: string[] };

/** OpenSSH's option grammar ends at destination. Remote argv is never a local filename. */
export function sshResources(argv: readonly ShellWord[]): SshResources | undefined {
  if (programName(argv[0]?.value ?? "") !== "ssh") return undefined;
  const result: SshResources = { files: [], commands: [] };
  for (let index = 1; index < argv.length; index++) {
    const word = argv[index];
    if (!word) break;
    if (word.value === "--") {
      const destination = argv[index + 1]?.value;
      if (destination) result.destination = destination;
      break;
    }
    if (!word.value.startsWith("-") || word.value === "-") {
      result.destination = word.value;
      break;
    }
    for (let optionIndex = 1; optionIndex < word.value.length; optionIndex++) {
      const option = word.value[optionIndex] ?? "";
      if (!VALUE_OPTIONS.has(option)) continue;
      const attached = word.value.slice(optionIndex + 1);
      const value = attached ? word : argv[++index];
      const text = attached || value?.value;
      if (!text || value?.expands || value?.glob) break;
      if (FILE_OPTIONS.has(option)) result.files.push(text);
      if (option === "o") {
        const separator = [...text].findIndex(
          (character) => character === "=" || character === " ",
        );
        if (separator < 0) break;
        const name = text.slice(0, separator).toLowerCase();
        const setting = text.slice(separator + 1).trim();
        if (FILE_SETTINGS.has(name)) result.files.push(setting);
        if (COMMAND_SETTINGS.has(name)) result.commands.push(setting);
      }
      break;
    }
  }
  return result;
}
