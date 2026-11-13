import { configPath } from "../config/load";
import { isReasoningEffort } from "../core/types";
import { DiagnosticsRuntime } from "../observability/runtime";
import { invalidateProviderAuthorization } from "../providers/registry";
import { isObject } from "../util/json";
import {
  DICTIONARY_COMMANDS,
  type DictionaryCommandType,
  dictionaryHandlers,
} from "./dictionary-handlers";
import {
  EXTENSION_COMMANDS,
  type ExtensionCommandType,
  extensionHandlers,
} from "./extension-handlers";
import { saveProjectFile } from "./file-edit";
import { previewFile } from "./file-preview";
import { MODULE_COMMANDS, type ModuleCommandType, moduleHandlers } from "./module-handlers";
import { parseProviderTestCommand } from "./provider-state";
import { pullRequestContext } from "./pull-request-context";
import { count, headers, optionalId, page, required, strings } from "./server-input";
import {
  type Handler,
  type RunErrorReporter,
  SESSION_COMMANDS,
  sessionHandlers,
} from "./server-session-handlers";
import type { AppService } from "./service";
import { exportSession } from "./session-export";
import { TWIN_COMMANDS, type TwinCommandType, twinHandlers } from "./twin-handlers";
import { listWorkspaceFiles } from "./workspace";
import { changeWorkspaceFile, workspaceDirectories } from "./workspace-files";
import { workspaceGit } from "./workspace-git";
import { replaceWorkspace } from "./workspace-replace";
import { searchWorkspace } from "./workspace-search";

export type { CommandInput } from "./server-input";
export { isSessionId } from "./server-input";
export type { Reply } from "./server-session-handlers";

const PROTOCOLS = ["openai-chat", "openai-responses", "anthropic-messages", "gemini"] as const;

const APP_COMMANDS = [
  "context.pull-request",
  "hooks.test",
  "diagnostics.export",
  "telemetry.send",
  "catalog.list",
  "catalog.provider",
  "catalog.status",
  "catalog.sync",
  "commands.list",
  "files.list",
  "files.read",
  "files.write",
  "files.change",
  "files.search",
  "files.replace",
  "files.git",
  "ide.terminal",
  "hello",
  "model.probe",
  "model.set",
  "provider.actualize",
  "provider.discover",
  "provider.draft",
  "provider.test",
  "provider.reauthorize",
  "sessions.delete",
  "sessions.export",
  "sessions.fork",
  "sessions.get",
  "sessions.list",
  "sessions.rename",
  "sessions.search",
  "settings.get",
  "settings.save",
  "status",
  "trust.accept",
  "voice.status",
  "voice.transcribe",
  "voice.cancel",
  "voice.check",
  "voice.prepare",
] as const;

/** Every command the sidecar accepts. shell/agent-commands.json must list the same names. */
export const COMMAND_TYPES = [
  ...APP_COMMANDS,
  ...SESSION_COMMANDS,
  ...EXTENSION_COMMANDS,
  ...MODULE_COMMANDS,
  ...DICTIONARY_COMMANDS,
  ...TWIN_COMMANDS,
].sort() as readonly CommandType[];
export type CommandType =
  | (typeof APP_COMMANDS)[number]
  | (typeof SESSION_COMMANDS)[number]
  | ExtensionCommandType
  | ModuleCommandType
  | DictionaryCommandType
  | TwinCommandType;

/** Commands that change what the status line shows; the server sends a fresh one after them. */
export const REFRESH_AFTER: ReadonlySet<string> = new Set([
  "hello",
  "status",
  "trust.accept",
  "settings.save",
  "model.set",
]);

export function isCommandType(type: string): type is CommandType {
  return (COMMAND_TYPES as readonly string[]).includes(type);
}

/**
 * Validates each command and calls the app. A handler returns the response payload, or
 * undefined when the command has no response (the run streams events instead).
 */
export function createHandlers(
  app: AppService,
  onRunError: RunErrorReporter,
  diagnostics?: DiagnosticsRuntime,
): Record<CommandType, Handler> {
  return {
    ...appHandlers(app, diagnostics),
    ...sessionHandlers(app, onRunError),
    ...extensionHandlers(app),
    ...moduleHandlers(app),
    ...dictionaryHandlers(app),
    ...twinHandlers(app),
  };
}

function appHandlers(
  app: AppService,
  diagnostics?: DiagnosticsRuntime,
): Record<(typeof APP_COMMANDS)[number], Handler> {
  return {
    "hooks.test": async (command) => ({ hookTest: await app.testHook(command) }),
    "diagnostics.export": async () => ({
      diagnostics: await (diagnostics ?? new DiagnosticsRuntime(app.info().cwd)).bundle(
        app.settings().config,
        configPath(app.info().cwd),
      ),
    }),
    "telemetry.send": async () => {
      await (diagnostics ?? new DiagnosticsRuntime(app.info().cwd)).telemetry(
        app.settings().config,
      );
      return {};
    },
    hello: () => undefined,
    "context.pull-request": async (command) => ({
      contextReference: await pullRequestContext(required(command, "url")),
    }),
    status: async (command) => {
      const sessionId = optionalId(command, "sessionId");
      if (!sessionId) return undefined;
      return { state: await app.session.send({ type: "status", sessionId }) };
    },
    "trust.accept": async () => ({ info: await app.acceptTrust() }),
    "sessions.list": async (command) => {
      const query = typeof command.query === "string" ? command.query : undefined;
      const options = { ...page(command), ...(query === undefined ? {} : { query }) };
      return { sessions: await app.listSessions(options) };
    },
    "sessions.search": async (command) => {
      if (typeof command.query !== "string") throw new Error("query is required");
      return { sessions: await app.searchSessions(command.query, page(command)) };
    },
    "sessions.get": async (command) => ({ events: await app.readSession(required(command, "id")) }),
    "sessions.export": async (command) => ({
      exported: await exportSession(app.info().cwd, required(command, "id")),
    }),
    "sessions.rename": async (command) => ({
      session: await app.renameSession(required(command, "id"), required(command, "title")),
    }),
    "sessions.delete": async (command) => {
      const id = required(command, "id");
      if (command.confirm !== true) throw new Error("confirm: true is required");
      return { ...(await app.deleteSession(id, { confirm: true })) };
    },
    "sessions.fork": async (command) => {
      const id = required(command, "id");
      const sequence = count(command.sequence, "sequence");
      const turn = count(command.turn, "turn");
      if (turn === 0) throw new Error("turn must be a positive integer");
      const options = {
        ...(sequence === undefined ? {} : { sequence }),
        ...(turn === undefined ? {} : { turn }),
      };
      return { session: await app.forkSession(id, options) };
    },
    "settings.get": () => ({ settings: app.settings() }),
    "settings.save": async (command) => {
      if (!isObject(command.config)) throw new Error("config is required");
      const clearApiKeys = strings(command.clearApiKeys);
      return { info: await app.saveSettings({ config: command.config, clearApiKeys }) };
    },
    "catalog.status": async () => ({ status: await app.catalogStatus() }),
    "catalog.sync": async () => ({ status: await app.catalogSync() }),
    "catalog.list": async () => ({ providers: await app.catalogList() }),
    "catalog.provider": async (command) => ({
      provider: await app.catalogProvider(required(command, "id")),
    }),
    "model.probe": async (command) => {
      const message = "provider and model are required";
      const result = await app.probeModel(
        required(command, "provider", message),
        required(command, "model", message),
      );
      return { ...result };
    },
    "provider.actualize": async (command) => {
      const result = await app.actualizeProvider(required(command, "id"));
      return { result, info: result.info };
    },
    "provider.discover": async (command) => {
      const protocol = PROTOCOLS.find((item) => item === command.protocol);
      if (!protocol) throw new Error(`protocol must be ${PROTOCOLS.join(", ")}`);
      const apiKey = typeof command.apiKey === "string" ? command.apiKey : "";
      const extra = headers(command.headers);
      const result = await app.discover({
        protocol,
        baseUrl: required(command, "baseUrl").trim(),
        ...(apiKey.length > 0 ? { apiKey } : {}),
        ...(extra ? { headers: extra } : {}),
      });
      return { result };
    },
    "provider.draft": (command) => {
      if (!isObject(command.provider)) throw new Error("provider is required");
      const providerId = typeof command.providerId === "string" ? command.providerId : undefined;
      const result = app.registerDraft({
        provider: command.provider,
        ...(providerId ? { providerId } : {}),
      });
      return { result };
    },
    "provider.test": async (command) => ({
      result: await app.test(parseProviderTestCommand(command)),
    }),
    "provider.reauthorize": async (command) => {
      const providerId = required(command, "id");
      const model = required(command, "model");
      if (!app.settings().config.providers[providerId]?.models[model])
        throw new Error("Unknown provider or model");
      invalidateProviderAuthorization(providerId);
      return { result: await app.test({ providerId, model }) };
    },
    "model.set": async (command) => {
      const message = "provider and model are required";
      const reasoning = command.reasoning;
      if (reasoning !== undefined && !isReasoningEffort(reasoning)) {
        throw new Error("reasoning is invalid");
      }
      const variant = command.variant;
      if (variant !== undefined && typeof variant !== "string")
        throw new Error("variant is invalid");
      const info = await app.setModel({
        provider: required(command, "provider", message),
        model: required(command, "model", message),
        ...(reasoning ? { reasoning } : {}),
        ...(variant ? { variant } : {}),
      });
      return { info };
    },
    "files.list": async () => ({
      files: await listWorkspaceFiles(app.info().cwd),
      directories: await workspaceDirectories(app.info().cwd),
    }),
    "files.change": async (command) => {
      await changeWorkspaceFile(app.info().cwd, command);
      return {};
    },
    "files.search": async (command) => ({ search: await searchWorkspace(app.info().cwd, command) }),
    "files.replace": async (command) => ({
      replacement: await replaceWorkspace(app.info().cwd, command),
    }),
    "files.git": async (command) => ({ git: await workspaceGit(app.info().cwd, command) }),
    "ide.terminal": async (command) => ({ terminal: await app.ideTerminal.command(command) }),
    "files.read": async (command) => ({
      file: await previewFile(app.info().cwd, required(command, "path", "path is required")),
    }),
    "files.write": async (command) => ({ file: await saveProjectFile(app.info().cwd, command) }),
    "commands.list": async () => ({ commands: await app.listCommands() }),
    "voice.status": async () => ({ voice: await app.voice.status() }),
    "voice.check": async (command) => ({ voiceSetup: await app.voice.setup(command, false) }),
    "voice.prepare": async (command) => ({ voiceSetup: await app.voice.setup(command, true) }),
    "voice.transcribe": async (command) => ({ text: await app.voice.transcribe(command) }),
    "voice.cancel": (command) => {
      app.voice.cancel(required(command, "id"));
      return {};
    },
  };
}
