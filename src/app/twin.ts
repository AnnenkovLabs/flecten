import type { ModelChoice } from "../../shared/model-choice";
import {
  TwinCandidateSchema,
  TwinConfigureSchema,
  type TwinDelegateInput,
  TwinDelegateInputSchema,
  TwinForgetSchema,
  TwinReviewSchema,
  type TwinSnapshot,
  TwinSnapshotSchema,
  TwinTeachSchema,
  type TwinTraceStep,
  TwinTrainSchema,
  TwinUpdateSchema,
} from "../../shared/twin";
import { safeMemoryText } from "../core/memory/sources";
import { delegate, type InferenceTarget, learn } from "../twin/inference";
import { TwinInferenceError } from "../twin/inference-error";
import {
  collectTrainingMessages,
  discoverSource,
  type SourceDiscovery,
  sourceDefinitions,
  TWIN_LIMITS,
} from "../twin/sources";
import {
  buildTaughtTwinCandidate,
  emptyTwinState,
  idleTraining,
  mergeTwinAdditions,
  type TwinState,
  TwinStateStore,
} from "../twin/state";
import { Mutex } from "../util/mutex";
import { redactKnown } from "../util/redact";
import {
  appendTwinEntry,
  buildObserveMessage,
  mergeTwinBatchState,
  persistTwinFailure,
  toolAllowedRoots,
} from "./twin-factory";

interface TwinOptions {
  cwd: string;
  secrets(): readonly string[];
  target(choice?: ModelChoice): InferenceTarget;
  validateChoice?(choice: ModelChoice): void;
  home?: string;
}
/** The learned persona owns taste and voice. It is never injected as project memory. */
export async function projectTwin(options: TwinOptions) {
  const store = new TwinStateStore(options.cwd);
  let state: TwinState;
  let loadError: string | undefined;
  try {
    state = await store.load();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    state = {
      ...emptyTwinState(),
      enabled: false,
      training: { ...idleTraining(), state: "error", message: loadError },
    };
  }
  const definitions = sourceDefinitions(options.cwd, options.home);
  let discoveries: SourceDiscovery[] = definitions.map((source) => ({
    source,
    files: [],
    cwd: options.cwd,
    ...(options.home ? { home: options.home } : {}),
  }));
  const lifetime = new AbortController();
  const mutex = new Mutex();
  let operation: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let samples: NonNullable<TwinSnapshot["training"]["samples"]> = [];
  let trace: TwinTraceStep[] = [];
  const pushTrace = (step: TwinTraceStep) => {
    const idx = trace.findIndex((item) => item.id === step.id);
    trace =
      idx >= 0
        ? [...trace.slice(0, idx), step, ...trace.slice(idx + 1)]
        : [...trace, step].slice(-40);
  };
  const writable = () => {
    if (loadError) throw new Error(loadError);
  };
  const save = async (next: TwinState, signal?: AbortSignal) => {
    writable();
    await store.save(next, signal);
    state = next;
  };
  const mergeTrained = (
    candidates: TwinState["candidates"],
    digests: readonly string[],
    usage: TwinSnapshot["training"]["usage"],
    signal: AbortSignal,
    markReady: boolean,
  ) =>
    mutex.run(async () => {
      signal.throwIfAborted();
      const next = mergeTwinBatchState(
        state,
        candidates,
        digests,
        usage,
        TWIN_LIMITS.maxProfileEntries,
        markReady,
      );
      await save(next, signal);
    });
  const activeTarget = () => {
    try {
      return options.target(state.trainingModel);
    } catch {
      return undefined;
    }
  };
  async function get(): Promise<TwinSnapshot> {
    const current = activeTarget();
    return TwinSnapshotSchema.parse({
      enabled: state.enabled,
      ...(state.trainingModel ? { trainingModel: state.trainingModel } : {}),
      sources: discoveries.map(({ source }) => ({
        ...source,
        selected: state.sourceIds.includes(source.id),
      })),
      candidates: state.candidates,
      entries: state.entries,
      training: {
        ...state.training,
        ...(state.training.state === "idle" && current
          ? { provider: current.providerId, model: current.model }
          : {}),
        ...(operation && !["reading", "learning"].includes(state.training.state)
          ? { state: "learning" }
          : {}),
        ...(operation && samples.length ? { samples } : {}),
        ...(operation && trace.length ? { trace } : {}),
      },
      limits: TWIN_LIMITS,
    });
  }
  async function scan() {
    writable();
    if (operation)
      throw new Error("Wait for Twin learning to finish or cancel it before scanning.");
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(15_000)]);
    const context = { cwd: options.cwd, ...(options.home ? { home: options.home } : {}) };
    discoveries = await Promise.all(
      definitions.map((source) => discoverSource(source, signal, context)),
    );
    return get();
  }
  async function train(input: unknown) {
    const { sourceIds, trainingModel } = TwinTrainSchema.parse(input);
    writable();
    if (operation) throw new Error("Twin is already learning. Cancel the current import first.");
    if (state.candidates.length > 88)
      throw new Error("Review pending candidates before importing more history.");
    const effectiveModel = trainingModel ?? state.trainingModel;
    if (effectiveModel) options.validateChoice?.(effectiveModel);
    const target = options.target(effectiveModel);
    const controller = new AbortController();
    samples = [];
    trace = [];
    operation = controller;
    const signal = AbortSignal.any([
      controller.signal,
      lifetime.signal,
      AbortSignal.timeout(600_000),
    ]);
    const execute = async () => {
      let usage = idleTraining().usage;
      try {
        await mutex.run(() =>
          save(
            {
              ...state,
              ...(effectiveModel ? { trainingModel: effectiveModel } : {}),
              sourceIds: [...new Set(sourceIds)],
              training: {
                ...idleTraining(),
                state: "reading",
                provider: target.providerId,
                model: target.model,
              },
            },
            signal,
          ),
        );
        const context = { cwd: options.cwd, ...(options.home ? { home: options.home } : {}) };
        const selected = await Promise.all(
          definitions
            .filter((s) => sourceIds.includes(s.id))
            .map((s) => {
              const cached = discoveries.find((item) => item.source.id === s.id);
              if (
                cached &&
                cached.source.status !== "not-scanned" &&
                (cached.files.length > 0 || (cached.databases?.length ?? 0) > 0)
              )
                return cached;
              return discoverSource(s, signal, context);
            }),
        );
        discoveries = discoveries.map(
          (prior) => selected.find((item) => item.source.id === prior.source.id) ?? prior,
        );
        const { messages, sessions } = await collectTrainingMessages(
          selected,
          state.processed,
          options.secrets(),
          signal,
          (progress) => {
            if (progress.samples.length > 0 && samples.length === 0) samples = progress.samples;
            state = {
              ...state,
              training: {
                ...state.training,
                sessions: progress.sessions,
                messages: progress.messages,
              },
            };
            pushTrace({
              id: "reading-progress",
              kind: "tool",
              label: `Reading ${progress.sourceName}`,
              detail: `${progress.sessions} sessions · ${progress.messages} messages`,
              status: "running",
            });
          },
        );
        pushTrace({
          id: "reading-progress",
          kind: "tool",
          label: "Sources loaded",
          detail: `${sessions.size} sessions · ${messages.length} messages`,
          status: "done",
        });
        signal.throwIfAborted();
        if (!messages.length) {
          await mutex.run(() =>
            save(
              {
                ...state,
                training: {
                  ...state.training,
                  sessions: sessions.size,
                  messages: 0,
                  state: "ready",
                  message: "No new supported user messages were found. No model request was made.",
                },
              },
              signal,
            ),
          );
          return;
        }
        samples = messages.slice(0, 16).map((m) => ({
          sourceId: m.sourceId,
          sessionId: m.sessionId,
          quote: safeMemoryText(m.text, options.secrets()).slice(0, 4000),
        }));
        await mutex.run(() =>
          save(
            {
              ...state,
              training: {
                ...state.training,
                sessions: sessions.size,
                messages: messages.length,
                state: "learning",
              },
            },
            signal,
          ),
        );
        const snapshot = await get();
        const result = await learn(
          target,
          messages,
          [...snapshot.entries, ...state.candidates],
          options.secrets(),
          signal,
          {
            cwd: options.cwd,
            allowedRoots: toolAllowedRoots(selected),
            messages,
            secrets: options.secrets(),
          },
          pushTrace,
          async (partial) => {
            usage = partial.usage;
            if (
              partial.totalBatches > 1 &&
              (partial.candidates.length || partial.processedDigests.length)
            ) {
              await mergeTrained(
                partial.candidates,
                partial.processedDigests,
                partial.usage,
                signal,
                false,
              );
            }
          },
        );
        usage = result.usage;
        signal.throwIfAborted();
        await mergeTrained(result.candidates, result.processedDigests, usage, signal, true);
      } catch (error) {
        await mutex.run(() =>
          persistTwinFailure(
            error,
            usage,
            controller.signal.aborted || lifetime.signal.aborted,
            options.secrets(),
            state,
            TwinInferenceError,
            (next) => save(next),
            (next) => {
              state = next;
            },
          ),
        );
      } finally {
        samples = [];
        trace = [];
        operation = undefined;
      }
    };
    pending = execute();
    void pending.catch(() => undefined);
    return get();
  }

  return {
    get,
    scan,
    train,

    async update(input: unknown) {
      const parsed = TwinUpdateSchema.parse(input);
      return mutex.run(async () => {
        writable();
        const entry = state.entries.find((entry) => entry.id === parsed.id);
        if (!entry || entry.revision !== parsed.expectedRevision)
          throw new Error("Twin revision conflict. Reload before editing this trait.");
        if (safeMemoryText(JSON.stringify(parsed), options.secrets()) !== JSON.stringify(parsed))
          throw new Error("Remove credentials before saving a trait.");
        const updated = {
          ...entry,
          ...parsed.edits,
          revision: entry.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        await save({
          ...state,
          entries: state.entries.map((current) => (current.id === entry.id ? updated : current)),
        });
        return get();
      });
    },
    async configure(input: unknown) {
      const parsed = TwinConfigureSchema.parse(input);
      if (parsed.trainingModel) options.validateChoice?.(parsed.trainingModel);
      if (parsed.enabled === false) {
        operation?.abort(new Error("Twin disabled by the user."));
        await pending;
      }
      return mutex.run(async () => {
        writable();
        const next: TwinState = {
          ...state,
          ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
          ...(parsed.sourceIds === undefined ? {} : { sourceIds: [...new Set(parsed.sourceIds)] }),
        };
        if (parsed.trainingModel === null) delete next.trainingModel;
        else if (parsed.trainingModel !== undefined) next.trainingModel = parsed.trainingModel;
        await save(next);
        return get();
      });
    },
    async cancel() {
      operation?.abort(new Error("Learning cancelled by the user."));
      await pending;
      return get();
    },
    async review(input: unknown) {
      const { candidateId, action, edits } = TwinReviewSchema.parse(input);
      return mutex.run(async () => {
        writable();
        const candidate = state.candidates.find((item) => item.id === candidateId);
        if (!candidate)
          throw new Error("Candidate no longer exists. Reload Twin before reviewing it.");
        let entries = state.entries;
        if (action === "accept") {
          const accepted = TwinCandidateSchema.parse({ ...candidate, ...edits });
          if (
            safeMemoryText(JSON.stringify(accepted), options.secrets()) !== JSON.stringify(accepted)
          )
            throw new Error("Remove credentials before saving a preference.");
          entries = appendTwinEntry(entries, accepted, TWIN_LIMITS.maxProfileEntries);
        }
        await save({
          ...state,
          entries,
          candidates: state.candidates.filter((i) => i.id !== candidateId),
        });
        return get();
      });
    },
    async forget(input: unknown) {
      const { id, expectedRevision } = TwinForgetSchema.parse(input);
      return mutex.run(async () => {
        writable();
        const entry = state.entries.find((entry) => entry.id === id);
        if (!entry) throw new Error("Twin trait not found");
        if (entry.revision !== expectedRevision)
          throw new Error("Twin revision conflict. Reload before forgetting this trait.");
        await save({ ...state, entries: state.entries.filter((entry) => entry.id !== id) });
        return get();
      });
    },
    async teach(input: unknown) {
      const parsed = TwinTeachSchema.parse(input);
      if (safeMemoryText(JSON.stringify(parsed), options.secrets()) !== JSON.stringify(parsed))
        throw new Error("Remove credentials before teaching Twin.");
      const candidate = buildTaughtTwinCandidate(parsed);
      return mutex.run(async () => {
        writable();
        await save({
          ...state,
          entries: appendTwinEntry(state.entries, candidate, TWIN_LIMITS.maxProfileEntries),
        });
        return get();
      });
    },
    async delegate(input: TwinDelegateInput, signal: AbortSignal) {
      const parsed = TwinDelegateInputSchema.parse(redactKnown(input, options.secrets()));
      if (!state.enabled) throw new Error("Twin is disabled");
      const timeout = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(60_000)]);
      const decision = await delegate(options.target(), parsed, state.entries, timeout, {
        cwd: options.cwd,
        secrets: options.secrets(),
      });
      return {
        ...decision,
        voice: safeMemoryText(decision.voice, options.secrets()),
        instructions: safeMemoryText(decision.instructions, options.secrets()),
      };
    },
    async observe(
      input: { sessionId: string; text: string; precedingAssistant?: string; reference?: string },
      signal?: AbortSignal,
    ) {
      if (!state.enabled || operation || loadError) return undefined;
      const built = buildObserveMessage(
        input.sessionId,
        input.text,
        options.secrets(),
        state.processed,
        input.precedingAssistant,
        input.reference,
      );
      if (!built) return undefined;
      const result = await learn(
        options.target(),
        [built.message],
        [...state.entries, ...state.candidates],
        options.secrets(),
        AbortSignal.any([
          ...(signal ? [signal] : []),
          lifetime.signal,
          AbortSignal.timeout(30_000),
        ]),
      ).catch(() => undefined);
      if (!result) return undefined;
      return mutex.run(async () => {
        if (operation || loadError) return undefined;
        const next = mergeTwinAdditions(
          state,
          result.candidates,
          [built.digest],
          TWIN_LIMITS.maxProfileEntries,
        );
        await save({ ...state, entries: next.entries, processed: next.processed });
        return { added: next.accepted, usage: result.usage };
      });
    },
    async dispose() {
      lifetime.abort();
      await pending;
    },
  };
}
