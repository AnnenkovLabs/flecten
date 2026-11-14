import { productEnv } from "../../shared/environment.cjs";
import { loadConfig, saveConfig } from "../config/load";
import type { HarnessConfig } from "../config/schema";
import { createSession, type SessionOptions } from "../core/session/session";
import { catalogStatus, providerFromCatalog, syncCatalog } from "../providers/catalog";
import { discoverProvider } from "../providers/discovery";
import { createProvider } from "../providers/registry";
import type { ModelProvider } from "../providers/types";
import { PermissionEngine } from "../security/permissions";
import type { PermissionRule } from "../security/types";
import { discoverSkills } from "../skills/discover";
import type { SkillActivations } from "../skills/tool";
import { loadSessionMedia, saveSessionMedia } from "../store/attachments";
import { pageSink } from "../store/pages";
import { sessionPaths } from "../store/paths";
import { saveQueue } from "../store/queue";
import { appInfo } from "./app-info";
import { createConversation } from "./conversation";
import { conversationOptions } from "./conversation-options";
import { projectDictionary } from "./dictionary";
import { extensionRuntime } from "./extension-runtime";
import {
  type AppExtensions,
  createExtensions,
  deferredExtensions,
  registryFor,
  withSkills,
} from "./extensions";
import { testHook } from "./hook-test";
import { IdeTerminal } from "./ide-terminal";
import { projectMemory } from "./memory";
import { moduleService } from "./modules";
import { configWithRememberedRules } from "./permission-persistence";
import { projectTrust, saveProjectTrust } from "./project-trust";
import { providerOps } from "./provider-ops";
import { configSecrets } from "./provider-secrets";
import {
  describeProviderError,
  hydrateActiveModel,
  maxOutputTokens,
  modelContext,
  unconfiguredProvider,
} from "./provider-state";
import { autoResumable, markInterrupted } from "./recovery";
import { RunSpend } from "./run-spend";
import { RESUME_PROMPT, slashCommands } from "./service-commands";
import { inputModalities, osSandboxFor, permissionRules, sandboxFor } from "./service-policy";
import { settingsActions } from "./service-settings";
import type { AppInfo, AppService } from "./service-types";
import {
  approvalTimeout,
  destructivePolicy,
  runBudgets,
  systemPrompt,
  terminalSettings,
  usagePrice,
} from "./session-config";
import { sessionRetention } from "./session-history";
import { SessionPool } from "./session-pool";
import { sessionModelHistory } from "./session-replay";
import { restoredSession } from "./session-restore";
import { SessionStorage } from "./session-storage";
import { CheckpointStore, pruneCheckpoints, ShellSnapshots } from "./shell-checkpoints";
import { subagentChildRunner } from "./subagent-child";
import { appSubagents, subagentToolCatalog } from "./subagents";
import { translationOptions } from "./translation";
import { createTwin } from "./twin";
import { visionOptions } from "./vision";
import { voiceService } from "./voice";

export type * from "./service-types";
export async function createAppService(
  cwd: string,
  projectRoot: string | null = cwd,
): Promise<AppService> {
  let config: HarnessConfig = await loadConfig(cwd, productEnv("CONFIG"));
  const voice = voiceService(() => config);
  const ideTerminal = new IdeTerminal(cwd, () => terminalSettings(config));
  const language = translationOptions();
  try {
    await hydrateActiveModel(config, cwd);
  } catch {}
  const memory = projectMemory(cwd, () => configSecrets(config));
  await memory.port.list().catch(() => undefined);
  const dictionary = await projectDictionary(cwd, memory.port, () => configSecrets(config));

  const skills = await discoverSkills(cwd, {
    projectRoot,
    sources: config.skills?.sources,
    trust: config.skills?.trust,
  });
  const trustRequired = projectRoot !== null;
  let trustState = projectTrust(cwd, projectRoot);
  let trusted = trustState === "trusted";
  const skillActivations: SkillActivations = new Map();
  let extensions: AppExtensions = { ...deferredExtensions(skills), skillActivations };
  let extensionRefresh: Promise<void> = Promise.resolve();
  const extensionControl = extensionRuntime(cwd, () => extensions, refreshExtensions);
  if (trusted)
    extensions = await createExtensions(
      cwd,
      config,
      extensionControl.options,
      skillActivations,
      projectRoot,
    );
  let mcpConfiguration = trusted ? JSON.stringify(config.mcp) : undefined;
  const modules = moduleService(
    cwd,
    () => config,
    () => trusted,
    commit,
    extensionControl,
  );
  const logs = new SessionStorage(
    cwd,
    () => configSecrets(config),
    () => modules.runtime.services(),
    () => modules.runtime.project.prepare(new AbortController().signal),
  );
  await modules.runtime.project.prepare(new AbortController().signal);
  let tools = registryFor(() => extensions, config, modules.runtime.tool);
  let prompt = await systemPrompt(cwd, config, extensions.sections, tools, undefined, projectRoot);

  let writes: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const next = writes.then(task, task);
    writes = next.catch(() => undefined);
    return next;
  }
  function rememberRule(rules: readonly PermissionRule[], signal: AbortSignal): Promise<void> {
    return serialized(async () => {
      signal.throwIfAborted();
      const next = configWithRememberedRules(config, rules);
      if (!next) return;
      await saveConfig(cwd, next, { signal });
      config = next;
    });
  }

  const permissionsFor = () =>
    new PermissionEngine({
      rules: permissionRules(config),
      destructive: destructivePolicy(config),
      onRemember: rememberRule,
    });
  const permissions = permissionsFor();
  let sandbox = sandboxFor(config, cwd);
  let osSandbox = osSandboxFor(config, cwd);

  const checkpoints = new CheckpointStore({ cwd });
  await checkpoints.init().catch(() => undefined);
  const pruning = pruneCheckpoints(checkpoints, config).catch(() => undefined);
  const shell = new ShellSnapshots(cwd, checkpoints, projectRoot !== null);
  shell.configure(config);

  let configError: string | undefined;
  const buildProvider = (): ModelProvider => {
    try {
      const active = createProvider(config);
      configError = undefined;
      return active.provider;
    } catch (error) {
      configError = describeProviderError(
        error,
        config.provider,
        config.providers[config.provider],
      );
      return unconfiguredProvider(error, config.model);
    }
  };
  let provider = buildProvider();
  const twin = await createTwin(cwd, { config: () => config, provider: () => provider });
  const runChild = subagentChildRunner({
    modules: modules.runtime,
    memory: memory.port,
    dictionary: { list: async () => (await dictionary.list()).entries },
    cwd,
    projectRoot,
    config: () => config,
    provider: () => provider,
    tools: () => tools,
    trusted: () => trusted,
    checkpoints,
    shellCheckpoints: () => shell.service,
    sandbox: () => sandbox,
    osSandbox: () => osSandbox,
  });
  const subagentsFor = () =>
    appSubagents(
      cwd,
      trusted && projectRoot !== null,
      tools,
      runChild,
      config.subagents?.dirs ?? [],
    );
  let subagents = subagentsFor();
  subagentToolCatalog(tools, subagents);
  prompt = await systemPrompt(cwd, config, extensions.sections, tools, undefined, projectRoot);
  const commands = slashCommands(
    cwd,
    () => extensions.skills.skills,
    () => config.commands?.dirs ?? [],
    projectRoot !== null,
  );

  function refreshExtensions(): Promise<void> {
    const next = extensionRefresh.then(refreshExtensionState, refreshExtensionState);
    extensionRefresh = next.catch(() => undefined);
    return next;
  }

  async function refreshExtensionState(): Promise<void> {
    await modules.runtime.project.prepare(new AbortController().signal);
    const nextMcp = JSON.stringify(config.mcp);
    if (trusted && nextMcp !== mcpConfiguration) {
      await extensions.dispose();
      extensions = await createExtensions(
        cwd,
        config,
        extensionControl.options,
        skillActivations,
        projectRoot,
      );
      mcpConfiguration = nextMcp;
    }
    const discovery = await discoverSkills(cwd, {
      projectRoot,
      sources: config.skills?.sources,
      trust: config.skills?.trust,
    });
    extensions = withSkills(extensions, discovery, trusted);
    tools = registryFor(() => extensions, config, modules.runtime.tool);
    subagents = subagentsFor();
    subagentToolCatalog(tools, subagents);
    prompt = await systemPrompt(cwd, config, extensions.sections, tools, undefined, projectRoot);
    pool.update({
      tools,
      system: prompt.system,
      systemParts: prompt.systemParts,
      promptStamp: prompt.stamp,
      hooks: trusted ? config.hooks : {},
      subagentRunnerFactory: subagents.factory,
    });
  }

  const liveOptions = () =>
    ({
      provider,
      modules: modules.runtime,
      vision: visionOptions(config),
      language: config.conversation?.enabled ? undefined : language(config),
      providerId: config.provider,
      secrets: () => configSecrets(config),
      model: config.model,
      tools,
      system: prompt.system,
      systemParts: prompt.systemParts,
      promptStamp: prompt.stamp,
      limits: config.tools,
      maxOutputTokens: maxOutputTokens(config),
      reasoning: config.reasoning,
      variant: config.variant,
      context: modelContext(config),
      loop: config.loop,
      ...(trusted ? { hooks: config.hooks } : {}),
      permissions,
      approvalTimeoutMs: approvalTimeout(config),
      budgets: runBudgets(config),
      price: usagePrice(config),
      sandbox,
      osSandbox,
      security: () => ({ sandbox, osSandbox }),
      terminal: terminalSettings(config),
      shellCheckpoints: shell.service,
      modalities: inputModalities(config),
      memory: memory.port,
      dictionary: { list: async () => (await dictionary.list()).entries },
    }) satisfies Partial<SessionOptions>;

  const sessionOptions = (): SessionOptions => ({
    cwd,
    ...liveOptions(),
    checkpoints,
    subagentRunnerFactory: subagents.factory,
    pages: (sessionId) => pageSink(sessionPaths(cwd, sessionId), () => configSecrets(config)),
    expandPrompt: commands.expand,
    logDir: (sessionId) => sessionPaths(cwd, sessionId).logs,
    loadHistory: (sessionId) => sessionModelHistory(cwd, sessionId, skillActivations, logs),
    saveMedia: (sessionId, parts) => saveSessionMedia(cwd, sessionId, parts),
    loadMedia: (sessionId, refs) => loadSessionMedia(cwd, sessionId, refs),
    saveQueue: (sessionId, queue) => saveQueue(cwd, sessionId, queue),
    onEvent: (event) => logs.persist(event),
  });

  const pool = new SessionPool({
    maxActive: () => config.sessions?.maxConcurrent ?? 4,
    beforeRun: async () => {
      await refreshExtensions();
      void dictionary.refresh();
    },
    secrets: () => configSecrets(config),
    async create(sessionId) {
      const options = { ...sessionOptions(), ...(await restoredSession(cwd, sessionId, logs)) };
      const events = sessionId ? await logs.read(sessionId) : [];
      if (
        (config.conversation?.enabled && events.length === 0) ||
        events.some(
          (event) =>
            event.type === "worker.event" ||
            (event.type === "session.started" && event.role === "talker"),
        )
      ) {
        return createConversation(options, {
          events,
          twin,
          configure: (current, execute, answer) =>
            conversationOptions(current, config, extensions.sections, execute, answer, projectRoot),
        });
      }
      return createSession(options);
    },
  });

  const spend = new RunSpend();
  const retention = sessionRetention(
    cwd,
    () => config.sessions,
    pool,
    logs,
    (id) => spend.delete(id),
  );
  pool.subscribe((event) => spend.note(event));

  const info = (): AppInfo => {
    const focused = pool.getSessionId();
    return appInfo({
      cwd,
      projectRoot,
      config,
      cost: spend.get(focused)?.cost,
      trustRequired,
      trusted,
      trustState,
      extensions,
      memoryRecords: memory.count,
      prompt: prompt.stamp,
      shell: shell.state,
      configError,
    });
  };

  async function apply(): Promise<void> {
    provider = buildProvider();
    permissions.replaceRules({
      rules: permissionRules(config),
      destructive: destructivePolicy(config),
    });
    sandbox = sandboxFor(config, cwd);
    osSandbox = osSandboxFor(config, cwd);
    tools.setLimits(config.tools);
    shell.configure(config);
    await refreshExtensions();
    pool.update(liveOptions());
  }
  function commit(next: HarnessConfig | (() => HarnessConfig), clearSecrets: string[] = []) {
    return serialized(async () => {
      if (typeof next === "function") next = next();
      await saveConfig(cwd, next, { clearSecrets });
      config = await loadConfig(cwd, productEnv("CONFIG"));
      await apply();
    });
  }
  const providers = providerOps({
    cwd,
    config: () => config,
    commit: (next) => commit(next),
    info,
  });

  if (config.catalog.autoRefresh) {
    void catalogStatus(cwd)
      .then((status) => (status.stale ? syncCatalog(cwd) : status))
      .catch(() => undefined);
    const timer = setInterval(
      () => void syncCatalog(cwd).catch(() => undefined),
      Math.max(config.catalog.ttlMs, 60 * 60 * 1000),
    );
    timer.unref?.();
  }

  async function acceptTrust() {
    if (projectRoot === null || trusted) return info();
    saveProjectTrust(cwd, projectRoot, "trusted");
    trustState = "trusted";
    trusted = true;
    await refreshExtensions();
    return info();
  }

  async function rejectTrust() {
    if (projectRoot === null) return info();
    if (pool.activity().some((session) => session.running))
      throw new Error("Stop running sessions before changing project trust.");
    saveProjectTrust(cwd, projectRoot, "untrusted");
    trustState = "untrusted";
    trusted = false;
    await extensions.dispose();
    extensions = { ...deferredExtensions(extensions.skills), skillActivations };
    mcpConfiguration = undefined;
    await refreshExtensions();
    return info();
  }

  return {
    twin,
    dictionary,
    modules,
    voice,
    ideTerminal,
    testHook: (input) => {
      if (!trusted) throw new Error("Accept project trust before running hooks");
      return testHook(cwd, config, input);
    },
    extensions: extensionControl,
    async reloadSkills() {
      await refreshExtensions();
      return extensionControl.skills();
    },
    session: pool,
    info,
    async listCommands() {
      await refreshExtensions();
      return commands.list();
    },
    ...settingsActions(() => config, commit, info),
    discover: (input) => discoverProvider(cwd, input),
    listSessions: async (options) => {
      await retention.maintain();
      return logs.list(options);
    },
    searchSessions: async (query, options) => {
      await retention.maintain();
      return logs.list({ ...options, query });
    },
    readSession: (id) => logs.read(id),
    renameSession: (id, title) => logs.rename(id, title),
    async deleteSession(id, input) {
      const confirmed = input === true || (typeof input === "object" && input.confirm === true);
      if (!confirmed) throw new Error("delete requires confirm: true");
      if (pool.busy(id)) throw new Error("Нельзя удалить задачу, пока агент работает");
      await pool.close(id);
      await logs.close(id);
      spend.delete(id);
      return logs.delete(id);
    },
    forkSession: (id, options) => logs.fork(id, options),
    test: providers.test,
    registerDraft: providers.registerDraft,
    acceptTrust,
    rejectTrust,
    catalogList: providers.catalogList,
    catalogProvider: providers.catalogProvider,
    catalogStatus: () => catalogStatus(cwd),
    catalogSync: () => syncCatalog(cwd),
    probeModel: providers.probeModel,
    actualizeProvider: providers.actualizeProvider,
    async resumeInterrupted() {
      const runs = await markInterrupted(cwd, (event) => logs.persist(event), logs).catch(() => []);
      const resumable = autoResumable(config, runs).slice(0, config.sessions?.maxConcurrent ?? 4);
      for (const run of resumable) {
        void pool
          .send({ type: "run", prompt: RESUME_PROMPT, sessionId: run.sessionId, resumed: true })
          .catch(() => undefined);
      }
      return {
        interrupted: runs.map((run) => run.sessionId),
        resumed: resumable.map((run) => run.sessionId),
      };
    },
    async dispose() {
      await retention.settled();
      voice.dispose();
      await twin.dispose();
      await ideTerminal.dispose();
      extensionControl.close();
      await pool.dispose();
      await writes.catch(() => undefined);
      await Promise.all([shell.settled(), pruning]);
      await logs.closeAll();
      await modules.dispose();
      providers.clearDrafts();
      await extensions.dispose();
    },
  };
}

export { providerFromCatalog };
