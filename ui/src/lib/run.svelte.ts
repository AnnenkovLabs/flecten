import type { CustomCommandInfo } from "./agent-protocol";
import { contextMentions } from "./composer/context-mentions";
import type { ContextReference } from "./composer/context-types";
import {
  composerDrafts,
  composerTaskKey,
  listenComposerDrafts,
  moveComposerDraft,
  savedComposerTask,
  setComposerProject,
  setComposerTask,
} from "./composer/drafts.svelte";
import type { SendMode } from "./composer/types";
import type { ContextView } from "./context-meter.svelte";
import { onAgentEvent, requestAgent, sendAgent } from "./desktop";
import { DictionaryStore } from "./dictionary.svelte";
import { t } from "./i18n.svelte";
import { IdeWorkspace } from "./ide.svelte";
import { ModuleStore } from "./modules/store.svelte";
import { applyPreferences, preferences } from "./preferences.svelte";
import { TaskActivity } from "./run/activity.svelte";
import { afterReplay, attachedEvents, isSessionEvent } from "./run/attach";
import { backgroundEvent } from "./run/background";
import { Checkpoints } from "./run/checkpoints.svelte";
import { RunControls } from "./run/controls.svelte";
import { listenIntents } from "./run/intents";
import { MessageHistory } from "./run/message-history.svelte";
import { type ModelHost, RunModels } from "./run/model";
import { Projects } from "./run/projects.svelte";
import { Reconnect } from "./run/reconnect";
import { finishedSessions, startedSessions } from "./run/sessions";
import { StorageMigration } from "./run/storage-migration.svelte";
import { TaskCommands } from "./run/task-commands";
import { type SessionEvent, TaskView } from "./run/view.svelte";
import { errorMessage as message } from "./run-errors";
import { nextId, nowIso, storedReasoning, uniqueId } from "./run-helpers";
import { listenTaskEvents, refreshTasks, type TaskHost } from "./run-tasks";
import { extensions } from "./settings/extensions.svelte";
import { toast } from "./toast.svelte";
import { TwinStore } from "./twin.svelte";
import type {
  AgentEvent,
  AgentInfo,
  AgentSessionSummary,
  Project,
  ReasoningChoice,
  TaskStatusKind,
} from "./types";
import { focusComposer, taskStatus } from "./ui-polish";
import { UserProfile } from "./user-profile.svelte";

export class RunStore implements TaskHost, ModelHost {
  readonly profile = new UserProfile();
  readonly dictionary = new DictionaryStore();
  readonly migration = new StorageMigration();
  readonly directories = new Projects();
  readonly twin = new TwinStore();
  readonly modules = new ModuleStore(() => this.#sessionId);
  readonly ide = new IdeWorkspace();
  info = $state<AgentInfo | null>(null);
  connection = $state<"connecting" | "ready" | "offline">("connecting");
  commands = $state<CustomCommandInfo[]>([]);
  reasoning = $state<ReasoningChoice>(storedReasoning());
  variant = $state<string | undefined>(undefined);
  readonly #models = new RunModels(this);
  get modelChange(): Promise<void> {
    return this.#models.ready(this.#sessionId);
  }
  sessions = $state<AgentSessionSummary[]>([]);
  activeTask = $state("current");
  openingTask = $state<string | null>(null);
  get contextMentions() {
    return contextMentions(this.ide.context, this.sessions, extensions.mcp);
  }
  get sendMode(): SendMode {
    return this.view.isTalker ? "steer" : preferences.followUpBehavior;
  }
  files = $state<string[]>([]);
  readonly activity = new TaskActivity();
  readonly view = new TaskView({ checkpointSaved: () => void this.checkpoints.refresh() });
  readonly history = new MessageHistory({
    view: this.view,
    sessionId: () => this.#sessionId,
    connected: () => this.connection === "ready",
    modelReady: () => this.modelChange,
    reasoning: () => this.reasoning,
    reload: (id) => this.#open(id),
  });
  readonly controls = new RunControls(
    this.view,
    () => this.#sessionId,
    () => this.connection === "ready",
    (prompt) => this.start(prompt),
  );
  readonly task = new TaskCommands(this.view, () => this.#sessionId);
  readonly checkpoints = new Checkpoints({
    sessionId: () => this.#sessionId,
    onRestored: () => this.view.thread.clearFiles(),
  });
  #sessionId: string | null = null;
  #buffer: { id: string; events: SessionEvent[] } | null = null;
  #loadSequence = 0;
  #configErrorShown = false;
  #projectSequence = 0;
  #filesLoaded = false;
  #attached = false;
  readonly #reconnect = new Reconnect();
  get title(): string {
    return this.view.title;
  }
  set title(value: string) {
    this.view.title = value;
  }
  get busy(): boolean {
    return this.view.busy || this.history.changing;
  }
  get project(): string {
    return this.info?.projectRoot === null ? "" : this.info?.project || t("project");
  }
  get branch(): string {
    return this.info?.branch ?? "";
  }
  get model(): string {
    return this.info?.model || t("model");
  }
  get provider(): string {
    return this.info?.provider || "";
  }
  get userName(): string {
    return this.profile.name ?? (this.info?.user || t("you"));
  }
  get contextView(): ContextView {
    return { ...this.view.context.view(this.info?.contextWindow ?? 0), usage: this.view.usage };
  }
  get projects(): Project[] {
    return this.directories.groups(this.info, this.sessions, (session) => this.statusOf(session));
  }
  statusOf(session: AgentSessionSummary): TaskStatusKind {
    const state = this.activity.of(session.id);
    return taskStatus(session.stopReason, { ...state, running: this.isRunning(session.id) });
  }
  isRunning(id: string): boolean {
    return this.activity.of(id).running || (id === this.#sessionId && this.view.busy);
  }
  connect(): () => void {
    const unsubscribe = onAgentEvent((event) => this.handle(event));
    const stopTasks = listenTaskEvents(this);
    const stopIntents = listenIntents({
      approval: (sessionId, id, choice, feedback) =>
        void this.task.respondApproval(sessionId, id, choice, feedback),
      cancelTool: (callId) => void this.task.cancelTool(callId),
      continueTask: () => this.controls.continue(),
      stopJob: (id) => void this.task.stopJob(id),
      stopWorker: () => void this.task.stopWorker(),
    });
    const stopModules = this.modules.watch(() => this.connection === "ready");
    const stopDrafts = listenComposerDrafts();
    if (!sendAgent({ type: "hello" })) {
      this.connection = "offline";
    }
    return () => {
      stopTasks();
      stopIntents();
      unsubscribe();
      stopModules();
      stopDrafts();
      this.controls.dispose();
      this.#reconnect.dispose();
      this.twin.dispose();
    };
  }
  handle(event: AgentEvent): void {
    this.ide.handle(event);
    if (isSessionEvent(event)) {
      this.#sessionEvent(event);
      return;
    }
    switch (event.type) {
      case "storage.migration":
        this.migration.handle(event);
        return;
      case "projects.changed":
        void this.directories.refresh();
        return;
      case "session.open":
        void this.selectTask(event.id).catch((error: unknown) =>
          toast.error(t("Could not open task: {0}", [message(error)])),
        );
        return;
      case "status":
        this.#status(event);
        return;
      case "error":
        if (event.code === "project_locked") this.#reconnect.hold();
        if (!event.sessionId || event.sessionId === this.#sessionId) this.view.error(event);
        else toast.error(`«${this.#titleOf(event.sessionId)}»: ${event.message}`);
        return;
      case "agent.exit":
        this.#exit(event.message);
        return;
      case "project.changed":
        this.#projectChanged(event.cwd);
        return;
      case "sessions.interrupted":
        this.#interrupted(event.interrupted, event.resumed);
        return;
    }
  }
  submit(
    text: string,
    mode: SendMode = this.sendMode,
    attachments: string[] = [],
    contexts: ContextReference[] = [],
  ): boolean {
    if (text.trim().length === 0 && attachments.length === 0) return false;
    const sessionId = this.#sessionId;
    if (this.history.changing) return false;
    if (!this.view.busy || !sessionId) return this.start(text, attachments, contexts);
    const id = uniqueId("q");
    const extra = {
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(contexts.length > 0 ? { contexts } : {}),
    };
    const command =
      mode === "steer"
        ? ({ type: "steer", sessionId, id, text, ...extra } as const)
        : ({ type: "queue.add", sessionId, id, text, ...extra } as const);
    requestAgent(command, 10_000)
      .then((response) => {
        if (this.#sessionId === sessionId) this.view.attach(response.state);
      })
      .catch((error: unknown) => {
        toast.error(t("Message was not queued: {0}", [message(error)]));
      });
    return true;
  }
  start(text: string, attachments: string[] = [], contexts: ContextReference[] = []): boolean {
    if (this.busy || this.migration.snapshot) return false;
    const sessionId = this.ensureSession();
    this.view.begin(text);
    this.sessions = startedSessions(this.sessions, sessionId, text);
    const project = this.#projectSequence;
    const dispatch = (): boolean => {
      if (project !== this.#projectSequence) return false;
      const reasoning = this.#models.reasoningFor(sessionId);
      const sent = sendAgent({
        type: "run",
        prompt: text,
        sessionId,
        clientId: uniqueId("c"),
        ...(reasoning === "auto" ? {} : { reasoning }),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(contexts.length > 0 ? { contexts } : {}),
      });
      if (!sent) {
        this.view.failed(
          t("The core is only available in the app. Open the Electron window."),
          "bridge",
        );
        return false;
      }
      return true;
    };
    if (this.#models.pending(sessionId)) void this.modelChange.then(dispatch);
    else if (!dispatch()) return false;
    focusComposer();
    return true;
  }
  sessionId(): string | null {
    return this.#sessionId;
  }
  ensureSession(): string {
    const sessionId = this.#sessionId ?? uniqueId("s");
    if (this.#sessionId === null) {
      moveComposerDraft(composerDrafts.task, composerTaskKey(sessionId));
      this.#sessionId = sessionId;
      this.activeTask = sessionId;
      setComposerTask(sessionId);
      this.#models.focus(sessionId);
    }
    return sessionId;
  }
  stop = (): void => this.controls.stop();
  repeat(prompt?: string): void {
    const next = prompt ?? this.view.lastPrompt;
    if (next && !this.view.busy) this.start(next);
    // A locked project with nothing to repeat: the core tries the project again.
    else if (this.#reconnect.held) sendAgent({ type: "hello" });
  }
  newTask(): void {
    this.#loadSequence += 1;
    this.#buffer = null;
    this.openingTask = null;
    this.#show(null);
  }
  async selectTask(id: string): Promise<void> {
    if (id === this.activeTask) {
      this.#loadSequence += 1;
      this.#buffer = null;
      this.openingTask = null;
      return;
    }
    await this.#open(id);
  }
  refreshSessions(): Promise<void> {
    if (this.connection !== "ready" || this.migration.snapshot) return Promise.resolve();
    return Promise.all([refreshTasks(this), this.directories.refresh()]).then(() => undefined);
  }
  async loadCommands(): Promise<void> {
    if (this.connection !== "ready" || this.migration.snapshot) return;
    try {
      const response = await requestAgent({ type: "commands.list" }, 15_000);
      this.commands = response.commands ?? [];
    } catch {
      this.commands = [];
    }
  }
  async loadFiles(): Promise<void> {
    if (this.#filesLoaded && this.files.length > 0) return;
    try {
      const response = await requestAgent({ type: "files.list" }, 15_000);
      this.files = response.files ?? [];
      this.#filesLoaded = true;
    } catch {
      // The picker simply stays empty; typing a path still works.
    }
  }
  setSendMode(mode: SendMode): void {
    preferences.followUpBehavior = mode;
  }
  setReasoning(value: ReasoningChoice): void {
    void this.#models.reasoning(value);
  }
  setModel(provider: string, model: string): Promise<void> {
    return this.#models.choose(provider, model);
  }
  setVariant(value: string | undefined): Promise<void> {
    return this.#models.variant(value);
  }
  #titleOf(id: string): string {
    return this.sessions.find((session) => session.id === id)?.title || t("task");
  }
  #show(id: string | null): void {
    this.history.set([]);
    this.modules.reset();
    this.view.reset(id ? this.#titleOf(id) : "");
    this.#sessionId = id;
    this.activeTask = id ?? "current";
    setComposerTask(this.activeTask);
    this.#models.focus(id);
  }
  async #open(id: string): Promise<void> {
    const ticket = ++this.#loadSequence;
    const modelRevision = this.#models.revision(id);
    this.#buffer = { id, events: [] };
    this.openingTask = id;
    try {
      const [stored, replay, status] = await Promise.all([
        requestAgent({ type: "sessions.get", id }),
        requestAgent({ type: "events.replay", sessionId: id })
          .then((response) => response.replay)
          .catch(() => undefined),
        requestAgent({ type: "status", sessionId: id }),
      ]);
      if (ticket !== this.#loadSequence) return;
      const buffered = this.#buffer?.id === id ? this.#buffer.events : [];
      this.#buffer = null;
      const events = attachedEvents(stored.events ?? [], replay);
      this.#models.restore(id, [...events, ...buffered], status.info, modelRevision);
      this.#show(id);
      this.history.set(stored.messageVersions);
      this.view.restore(events);
      this.view.attach(status.state);
      for (const event of afterReplay(buffered, replay)) this.view.apply(event);
      focusComposer();
    } catch (error) {
      if (ticket === this.#loadSequence) {
        this.#buffer = null;
        toast.error(t("Could not open the task. Select it again. {0}", [message(error)]));
      }
    } finally {
      if (ticket === this.#loadSequence) this.openingTask = null;
    }
  }
  #sessionEvent(event: SessionEvent): void {
    this.activity.apply(event);
    if (event.type === "model.selected") this.#models.selected(event);
    if (event.type === "session.started" && !event.internal) {
      this.sessions = startedSessions(this.sessions, event.sessionId, event.prompt ?? "");
    } else if (event.type === "session.finished") {
      this.sessions = finishedSessions(this.sessions, event.sessionId, event.result.stopReason);
      if (event.sessionId === this.#sessionId) void this.history.refresh();
    }
    if (this.#buffer?.id === event.sessionId) this.#buffer.events.push(event);
    else if (event.sessionId === this.#sessionId) {
      if (!this.history.changing) this.view.apply(event);
    } else
      backgroundEvent(event, this.#titleOf(event.sessionId), () => void this.checkpoints.refresh());
  }
  #status(event: Extract<AgentEvent, { type: "status" }>): void {
    setComposerProject(event.cwd);
    applyPreferences(event.ui);
    const { type: _type, ...info } = event;
    this.#models.status(info);
    this.connection = "ready";
    if (this.migration.runtimeReady()) {
      void this.refreshSessions();
      void this.checkpoints.refresh();
      void this.loadCommands();
    }
    if (!this.twin.snapshot && !this.twin.busy) void this.twin.load();
    this.activity.sync(event.sessions ?? []);
    if (event.sessionId === this.#sessionId) this.view.attach(event);
    if (event.configError && !this.#configErrorShown) {
      this.#configErrorShown = true;
      this.view.thread.push({
        kind: "error",
        id: nextId("err"),
        text: event.configError,
        code: "config",
        at: nowIso(),
      });
    }
    if (this.#reconnect.ready()) {
      if (this.#sessionId) void this.#open(this.#sessionId);
      return;
    }
    const first = !this.#attached;
    this.#attached = true;
    if (!first || this.#sessionId !== null || this.view.thread.items.length > 0) return;
    const running =
      event.running && event.sessionId
        ? event.sessionId
        : (event.sessions ?? []).find((entry) => entry.running)?.sessionId;
    const restore = running ?? savedComposerTask();
    if (restore) void this.#open(restore);
  }
  #exit(reason: string | undefined): void {
    const wasBusy = this.view.busy;
    const first = !this.#reconnect.pending;
    this.connection = "offline";
    this.migration.interrupted();
    this.view.coreLost();
    this.activity.sync([]);
    this.#attached = true;
    // Another window holds the project: a restart would fail the same way. The next command
    // starts the core again, once that window is closed.
    if (this.#reconnect.held) return;
    const scheduled = this.#reconnect.schedule(() => {
      if (!sendAgent({ type: "hello" })) this.connection = "offline";
    });
    if (!scheduled && !this.migration.snapshot) {
      this.view.thread.push({
        kind: "error",
        id: nextId("err"),
        text: reason ?? t("The core cannot start. Check Settings and restart the app."),
        code: "agent_exit",
        at: nowIso(),
      });
      return;
    }
    if (first) {
      toast.show(wasBusy ? t("The core stopped during the run. Restarting") : t("Restarting core"));
    }
  }
  #projectChanged(cwd: string): void {
    setComposerProject(cwd);
    this.#projectSequence++;
    this.#models.reset();
    this.dictionary.reset();
    this.twin.reset();
    this.ide.reset();
    this.#loadSequence += 1;
    this.#buffer = null;
    this.#attached = false;
    this.sessions = [];
    this.files = [];
    this.#filesLoaded = false;
    this.activity.clear();
    this.checkpoints.reset();
    this.#show(null);
    this.info = null;
    this.connection = "connecting";
    this.migration.waitForRuntime();
  }
  #interrupted(interrupted: string[], resumed: string[]): void {
    this.activity.markInterrupted(interrupted, resumed);
    void this.refreshSessions();
    const waiting = interrupted.length - resumed.length;
    if (resumed.length > 0) {
      const rest = waiting > 0 ? t(", waiting for you: {0}", [waiting]) : "";
      toast.show(t("Resuming interrupted tasks: {0}{1}", [resumed.length, rest]));
    } else {
      toast.error(
        t("Interrupted tasks: {0}. Open a task and click Continue", [interrupted.length]),
      );
    }
    if (this.#sessionId && interrupted.includes(this.#sessionId)) void this.#open(this.#sessionId);
  }
}
