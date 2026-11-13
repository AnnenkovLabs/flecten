import type { CustomCommandInfo } from "./agent-protocol";
import { contextMentions } from "./composer/context-mentions";
import type { ContextReference } from "./composer/context-types";
import { composerDrafts, moveComposerDraft, setComposerTask } from "./composer/drafts.svelte";
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
import { Checkpoints } from "./run/checkpoints.svelte";
import { listenIntents } from "./run/intents";
import { chooseModel, chooseVariant, type ModelHost } from "./run/model";
import { Reconnect } from "./run/reconnect";
import { finishedLabel, finishedSessions, projectTasks, startedSessions } from "./run/sessions";
import { TaskCommands } from "./run/task-commands";
import { hasCheckpoint } from "./run/thread.svelte";
import { type SessionEvent, TaskView } from "./run/view.svelte";
import { errorMessage as message } from "./run-errors";
import {
  hasStoredReasoning,
  nextId,
  nowIso,
  storedReasoning,
  storeReasoning,
  uniqueId,
} from "./run-helpers";
import { listenTaskEvents, refreshTasks, searchTasks, type TaskHost } from "./run-tasks";
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

type StatusEvent = Extract<AgentEvent, { type: "status" }>;
export class RunStore implements TaskHost, ModelHost {
  readonly dictionary = new DictionaryStore();
  readonly twin = new TwinStore();
  readonly modules = new ModuleStore(() => this.#sessionId);
  readonly ide = new IdeWorkspace();
  info = $state<AgentInfo | null>(null);
  connection = $state<"connecting" | "ready" | "offline">("connecting");
  commands = $state<CustomCommandInfo[]>([]);
  reasoning = $state<ReasoningChoice>(storedReasoning());
  variant = $state<string | undefined>(undefined);
  sessions = $state<AgentSessionSummary[]>([]);
  activeTask = $state("current");
  openingTask = $state<string | null>(null);
  get contextMentions() {
    return contextMentions(this.ide.context, this.sessions, extensions.mcp);
  }
  get sendMode(): SendMode {
    return preferences.followUpBehavior;
  }
  files = $state<string[]>([]);
  readonly activity = new TaskActivity();
  readonly view = new TaskView({ checkpointSaved: () => void this.checkpoints.refresh() });
  readonly task = new TaskCommands(this.view, () => this.#sessionId);
  readonly checkpoints = new Checkpoints({
    sessionId: () => this.#sessionId,
    onRestored: () => this.view.thread.clearFiles(),
  });
  #sessionId: string | null = null;
  #buffer: { id: string; events: SessionEvent[] } | null = null;
  #loadSequence = 0;
  #configErrorShown = false;
  #reasoningTouched = hasStoredReasoning();
  #variantTouched = false;
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
    return this.view.busy;
  }
  get project(): string {
    return this.info?.project || t("project");
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
    return this.info?.user || t("you");
  }
  get contextView(): ContextView {
    return { ...this.view.context.view(this.info?.contextWindow ?? 0), usage: this.view.usage };
  }
  get projects(): Project[] {
    return projectTasks(this.sessions, this.project, (session) => this.statusOf(session));
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
      continueTask: () => this.submit("/continue", "queue"),
      stopJob: (id) => void this.task.stopJob(id),
      stopWorker: () => void this.task.stopWorker(),
    });
    const stopModules = this.modules.watch(() => this.connection === "ready");
    if (!sendAgent({ type: "hello" })) {
      this.connection = "offline";
    } else {
      void this.refreshSessions();
      void this.checkpoints.refresh();
    }
    return () => {
      stopTasks();
      stopIntents();
      unsubscribe();
      stopModules();
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
    if (this.view.busy) return false;
    const sessionId = this.ensureSession();
    this.view.begin(text);
    this.sessions = startedSessions(this.sessions, sessionId, text);
    const sent = sendAgent({
      type: "run",
      prompt: text,
      sessionId,
      clientId: uniqueId("c"),
      ...(this.reasoning === "auto" ? {} : { reasoning: this.reasoning }),
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
    focusComposer();
    return true;
  }

  ensureSession(): string {
    const sessionId = this.#sessionId ?? uniqueId("s");
    if (this.#sessionId === null) {
      if (composerDrafts.task === "current") {
        moveComposerDraft("current", sessionId);
      }
      this.#sessionId = sessionId;
      this.activeTask = sessionId;
      setComposerTask(sessionId);
    }
    return sessionId;
  }

  stop(): void {
    if ((!this.view.busy && !this.view.worker.running) || !this.#sessionId) return;
    const sessionId = this.#sessionId;
    requestAgent({ type: "stop", sessionId, mode: this.view.stopping ? "force" : "graceful" })
      .then((response) => {
        if (this.#sessionId === sessionId) this.view.attach(response.state);
      })
      .catch((error: unknown) => toast.error(t("Could not stop: {0}", [message(error)])));
  }

  repeat(prompt?: string): void {
    const next = prompt ?? this.view.lastPrompt;
    if (next && !this.view.busy) this.start(next);
    // A locked project with nothing to repeat: the core tries the project again.
    else if (this.#reconnect.held) sendAgent({ type: "hello" });
  }

  /** A clean screen for a new task; tasks already running go on behind it. */
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
    return refreshTasks(this);
  }

  searchSessions(query: string): Promise<void> {
    return searchTasks(this, query);
  }

  async loadCommands(): Promise<void> {
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
    this.reasoning = value;
    this.#reasoningTouched = true;
    storeReasoning(value);
  }

  touchVariant(touched: boolean): void {
    this.#variantTouched = touched;
  }

  setModel(provider: string, model: string): Promise<void> {
    return chooseModel(this, provider, model);
  }

  setVariant(value: string | undefined): Promise<void> {
    return chooseVariant(this, value);
  }

  #titleOf(id: string): string {
    return this.sessions.find((session) => session.id === id)?.title || t("task");
  }

  #show(id: string | null): void {
    this.modules.reset();
    this.view.reset(id ? this.#titleOf(id) : "");
    this.#sessionId = id;
    this.activeTask = id ?? "current";
    setComposerTask(this.activeTask);
  }

  /** Opens a task: its stored log, the live part of its run, then events that came meanwhile. */
  async #open(id: string): Promise<void> {
    const ticket = ++this.#loadSequence;
    this.#buffer = { id, events: [] };
    this.openingTask = id;
    try {
      const [stored, replay, state] = await Promise.all([
        requestAgent({ type: "sessions.get", id }),
        requestAgent({ type: "events.replay", sessionId: id })
          .then((response) => response.replay)
          .catch(() => undefined),
        requestAgent({ type: "status", sessionId: id }).then((response) => response.state),
      ]);
      if (ticket !== this.#loadSequence) return;
      const buffered = this.#buffer?.id === id ? this.#buffer.events : [];
      this.#buffer = null;
      this.#show(id);
      this.view.restore(attachedEvents(stored.events ?? [], replay));
      this.view.attach(state);
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
    if (event.type === "session.started" && !event.internal) {
      this.sessions = startedSessions(this.sessions, event.sessionId, event.prompt ?? "");
    } else if (event.type === "session.finished") {
      this.sessions = finishedSessions(this.sessions, event.sessionId, event.result.stopReason);
    }
    if (this.#buffer?.id === event.sessionId) this.#buffer.events.push(event);
    else if (event.sessionId === this.#sessionId) this.view.apply(event);
    else this.#background(event);
  }

  /** Events of a task behind the one on screen: only what needs the user's attention. */
  #background(event: SessionEvent): void {
    const title = this.#titleOf(event.sessionId);
    switch (event.type) {
      case "session.finished":
        toast.show(`«${title}»: ${finishedLabel(event.result.stopReason)}`);
        return;
      case "approval.requested":
        toast.show(t("“{0}” is waiting for permission: {1}", [title, event.approval.tool]));
        return;
      case "job.finished":
        if (event.notify) toast.show(t("“{0}”: background command finished", [title]));
        if (event.checkpoint !== undefined) void this.checkpoints.refresh();
        return;
      case "tool.finished":
        if (hasCheckpoint(event.result)) void this.checkpoints.refresh();
        return;
    }
  }

  #status(event: StatusEvent): void {
    applyPreferences(event.ui);
    const { type: _type, ...info } = event;
    this.info = info;
    this.connection = "ready";
    if (!this.#reasoningTouched) this.reasoning = event.reasoning ?? "auto";
    if (!this.#variantTouched) this.variant = event.variant;
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
      void this.refreshSessions();
      void this.checkpoints.refresh();
      if (this.#sessionId) void this.#open(this.#sessionId);
      return;
    }
    const first = !this.#attached;
    this.#attached = true;
    if (!first || this.#sessionId !== null || this.view.thread.items.length > 0) return;
    // A reloaded window opens the task the core is running instead of an empty screen.
    const running =
      event.running && event.sessionId
        ? event.sessionId
        : (event.sessions ?? []).find((entry) => entry.running)?.sessionId;
    if (running) void this.#open(running);
  }

  #exit(reason: string | undefined): void {
    const wasBusy = this.view.busy;
    const first = !this.#reconnect.pending;
    this.connection = "offline";
    this.view.coreLost();
    this.activity.sync([]);
    this.#attached = true;
    // Another window holds the project: a restart would fail the same way. The next command
    // starts the core again, once that window is closed.
    if (this.#reconnect.held) return;
    const scheduled = this.#reconnect.schedule(() => {
      if (!sendAgent({ type: "hello" })) this.connection = "offline";
    });
    if (!scheduled) {
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
    this.info = this.info ? { ...this.info, cwd } : null;
    void this.refreshSessions();
    void this.checkpoints.refresh();
  }

  /** A restarted core found runs it did not finish; some of them resume on their own. */
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
