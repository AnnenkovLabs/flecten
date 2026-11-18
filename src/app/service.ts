import { productEnv } from "../../shared/environment.cjs";
import { loadConfig, saveConfig } from "../config/load";
import type { HarnessConfig } from "../config/schema";
import type { SessionOptions } from "../core/session/session";
import { catalogStatus, providerFromCatalog, syncCatalog } from "../providers/catalog";
import { discoverProvider } from "../providers/discovery";
import { inspectProviderGateway } from "../providers/gateway-detection";
import { PermissionEngine } from "../security/permissions";
import type { PermissionRule } from "../security/types";
import { discoverSkills } from "../skills/discover";
import type { SkillActivations } from "../skills/tool";
import { loadSessionMedia, saveSessionMedia } from "../store/attachments";
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
import { messageBranches } from "./message-branches";
import { moduleService } from "./modules";
import { permissionAuthority } from "./permission-authority";
import { configWithRememberedRules } from "./permission-persistence";
import { projectTrust, saveProjectTrust } from "./project-trust";
import { providerAutoRefresh } from "./provider-auto-refresh";
import { providerOps } from "./provider-ops";
import { configSecrets } from "./provider-secrets";
import { hydrateActiveModel } from "./provider-state";
import { autoResumable, markInterrupted } from "./recovery";
import { RunSpend } from "./run-spend";
import { RESUME_PROMPT, slashCommands } from "./service-commands";
import { osSandboxFor, sandboxFor } from "./service-policy";
import { settingsActions } from "./service-settings";
import type { AppInfo, AppService } from "./service-types";
import { approvalTimeout, runBudgets, systemPrompt, terminalSettings } from "./session-config";
import { sessionRetention } from "./session-history";
import {
  configuredProvider,
  sessionModelOptions,
  sessionModelTools,
} from "./session-model-options";
import { sessionModels } from "./session-models";
import { sessionPages } from "./session-pages";
import { SessionPool } from "./session-pool";
import { sessionModelHistory } from "./session-replay";
import { restoredSession } from "./session-restore";
import { SessionStorage } from "./session-storage";
import { CheckpointStore, pruneCheckpoints, ShellSnapshots } from "./shell-checkpoints";
import { createSingleSession } from "./single-session";
import { subagentChildRunner } from "./subagent-child";
import { subagentModelFactory } from "./subagent-models";
import { appSubagents, subagentToolCatalog } from "./subagents";
import { translationOptions } from "./translation";
import { createTwin } from "./twin";
import { voiceService } from "./voice";

export type * from "./service-types";
export async function createAppService(
  cwd: string,
  projectRoot: string | null = cwd,
  onRefresh?: () => void,
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
  const models = sessionModels(logs);
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

  const permissions = new PermissionEngine({
    ...(await permissionAuthority(cwd, config)),
    onRemember: rememberRule,
  });
  let sandbox = sandboxFor(config, cwd);
  let osSandbox = osSandboxFor(config, cwd);

  const checkpoints = new CheckpointStore({ cwd });
  await checkpoints.init().catch(() => undefined);
  const pruning = pruneCheckpoints(checkpoints, config).catch(() => undefined);
  const shell = new ShellSnapshots(cwd, checkpoints, projectRoot !== null);
  shell.configure(config);

  let { provider, configError } = configuredProvider(config);
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
    pool.update((id) => ({
      tools: sessionModelTools(models.config(config, id), tools),
      system: prompt.system,
      systemParts: prompt.systemParts,
      promptStamp: prompt.stamp,
      hooks: trusted ? config.hooks : {},
      subagentRunnerFactory: subagentModelFactory(subagents.factory, models.config(config, id)),
    }));
  }

  const liveOptions = (sessionId?: string) => {
    const current = models.config(config, sessionId);
    return {
      ...sessionModelOptions(current, current === config ? provider : undefined),
      modules: modules.runtime,
      language: models.conversation(config, sessionId) ? undefined : language(current),
      subagentRunnerFactory: subagentModelFactory(subagents.factory, current),
      secrets: () => configSecrets(config),
      tools: sessionModelTools(current, tools),
      system: prompt.system,
      systemParts: prompt.systemParts,
      promptStamp: prompt.stamp,
      limits: config.tools,
      loop: config.loop,
      ...(trusted ? { hooks: config.hooks } : {}),
      permissions,
      approvalTimeoutMs: approvalTimeout(config),
      budgets: runBudgets(config),
      sandbox,
      osSandbox,
      security: () => ({ sandbox, osSandbox }),
      terminal: terminalSettings(config),
      shellCheckpoints: shell.service,
      memory: memory.port,
      dictionary: { list: async () => (await dictionary.list()).entries },
    } satisfies Partial<SessionOptions>;
  };

  const sessionOptions = (sessionId?: string): SessionOptions => ({
    cwd,
    ...liveOptions(sessionId),
    checkpoints,
    pages: sessionPages(cwd, logs, () => configSecrets(config)),
    expandPrompt: commands.expand,
    takeSummaryContext: (id) => pool.takeSummaryContext(id),
    logDir: (sessionId) => sessionPaths(cwd, sessionId).logs,
    loadHistory: (sessionId) =>
      sessionModelHistory(cwd, sessionId, skillActivations, logs, permissions),
    saveMedia: (sessionId, parts) => saveSessionMedia(cwd, sessionId, parts),
    loadMedia: (sessionId, refs) => loadSessionMedia(cwd, sessionId, refs),
    saveQueue: (sessionId, queue) => saveQueue(cwd, sessionId, queue),
    onEvent: (event) => logs.persist(event),
  });
  const pool: SessionPool = new SessionPool({
    maxActive: () => config.sessions?.maxConcurrent ?? 4,
    beforeRun: async () => {
      await refreshExtensions();
      void dictionary.refresh();
    },
    secrets: () => configSecrets(config),
    async create(sessionId) {
      if (sessionId) await models.load(sessionId);
      const options = {
        ...sessionOptions(sessionId),
        ...(await restoredSession(cwd, sessionId, logs)),
      };
      const events = sessionId ? await logs.read(sessionId) : [];
      if (models.conversation(config, sessionId)) {
        return createConversation(options, {
          events,
          twin,
          configure: (current, execute, answer) =>
            conversationOptions(
              current,
              config,
              extensions.sections,
              execute,
              answer,
              projectRoot,
              models.choice(current.sessionId ?? sessionId),
            ),
        });
      }
      return createSingleSession(options, events);
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
  pool.subscribe((event) => {
    spend.note(event);
    models.note(event);
  });

  const info = (sessionId?: string): AppInfo => {
    return {
      ...appInfo({
        cwd,
        projectRoot,
        config: models.config(config, sessionId),
        cost: spend.get(sessionId ?? pool.getSessionId())?.cost,
        trustRequired,
        trusted,
        trustState,
        extensions,
        memoryRecords: memory.count,
        prompt: prompt.stamp,
        shell: shell.state,
        configError,
      }),
      ...(sessionId ? { sessionId } : {}),
    };
  };

  async function apply(): Promise<void> {
    ({ provider, configError } = configuredProvider(config));
    permissions.replaceRules(await permissionAuthority(cwd, config));
    sandbox = sandboxFor(config, cwd);
    osSandbox = osSandboxFor(config, cwd);
    tools.setLimits(config.tools);
    shell.configure(config);
    await refreshExtensions();
    pool.update(liveOptions);
  }
  function commit(next: HarnessConfig | (() => HarnessConfig), clearSecrets: string[] = []) {
    return serialized(async () => {
      if (typeof next === "function") {
        next = next();
        if (next === config) return;
      }
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

  const providerRefresh = providerAutoRefresh({ cwd, config: () => config, commit, onRefresh });

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
    ...settingsActions(
      () => config,
      commit,
      info,
      async (input) => {
        const event = await models.select(input.sessionId, input);
        pool.updateSession(input.sessionId, liveOptions(input.sessionId));
        pool.publish(event);
        return info(input.sessionId);
      },
      () =>
        subagents.registry.list().map(({ id, name, description }) => ({ id, name, description })),
    ),
    inspectProvider: (baseUrl) => inspectProviderGateway(baseUrl),
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
    ...messageBranches(pool, logs, sessionOptions),
    renameSession: (id, title) => logs.rename(id, title),
    async deleteSession(id, input) {
      const confirmed = input === true || (typeof input === "object" && input.confirm === true);
      if (!confirmed) throw new Error("delete requires confirm: true");
      if (pool.busy(id)) throw new Error("Stop the active run before deleting this task.");
      await pool.close(id);
      await logs.close(id);
      spend.delete(id);
      return logs.delete(id);
    },
    forkSession: (id, options) => logs.fork(id, options),
    test: providers.test,
    modelMetadata: providers.modelMetadata,
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
      await providerRefresh.dispose();
      await retention.settled();
      voice.dispose();
      await twin.dispose();
      await ideTerminal.dispose();
      extensionControl.close();
      await pool.dispose();
      await models.settled();
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
