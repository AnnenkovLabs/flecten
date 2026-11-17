import {
  type TwinCandidate,
  TwinCandidateSchema,
  TwinConfigureSchema,
  TwinConsultSchema,
  type TwinDelegateInput,
  TwinDelegateInputSchema,
  TwinForgetSchema,
  TwinReviewSchema,
  type TwinSnapshot,
  TwinSnapshotSchema,
  TwinTeachSchema,
  TwinTrainSchema,
  TwinUpdateSchema,
} from "../../shared/twin";
import type { HarnessConfig } from "../config/schema";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import type { ModelProvider } from "../providers/types";
import { consult, delegate, type InferenceTarget, learn } from "../twin/inference";
import { TwinInferenceError } from "../twin/inference-error";
import {
  discoverSource,
  readSession,
  type SourceDiscovery,
  type SourceMessage,
  sourceDefinitions,
  sourceMessages,
  TWIN_LIMITS,
} from "../twin/sources";
import { emptyTwinState, idleTraining, type TwinState, TwinStateStore } from "../twin/state";
import { Mutex } from "../util/mutex";
import { redactKnown } from "../util/redact";
import { configSecrets } from "./provider-secrets";
import { inputModalities } from "./service-policy";
import { usagePrice } from "./session-config";
import { sessionModelOptions } from "./session-model-options";

interface TwinOptions {
  cwd: string;
  secrets(): readonly string[];
  target(): InferenceTarget;
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
  let discoveries: SourceDiscovery[] = definitions.map((source) => ({ source, files: [] }));
  const lifetime = new AbortController();
  const mutex = new Mutex();
  let operation: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let samples: NonNullable<TwinSnapshot["training"]["samples"]> = [];
  const writable = () => {
    if (loadError) throw new Error(loadError);
  };
  const save = async (next: TwinState, signal?: AbortSignal) => {
    writable();
    await store.save(next, signal);
    state = next;
  };

  async function get(): Promise<TwinSnapshot> {
    return TwinSnapshotSchema.parse({
      enabled: state.enabled,
      sources: discoveries.map(({ source }) => ({
        ...source,
        selected: state.sourceIds.includes(source.id),
      })),
      candidates: state.candidates,
      entries: state.entries,
      training: {
        ...state.training,
        ...(operation && !["reading", "learning"].includes(state.training.state)
          ? { state: "learning" }
          : {}),
        ...(operation && samples.length ? { samples } : {}),
      },
      limits: TWIN_LIMITS,
    });
  }

  async function scan() {
    writable();
    if (operation)
      throw new Error("Wait for Twin learning to finish or cancel it before scanning.");
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(15_000)]);
    discoveries = await Promise.all(definitions.map((source) => discoverSource(source, signal)));
    return get();
  }

  async function train(input: unknown) {
    const { sourceIds } = TwinTrainSchema.parse(input);
    writable();
    if (operation) throw new Error("Twin is already learning. Cancel the current import first.");
    if (state.candidates.length > 88)
      throw new Error("Review pending candidates before importing more history.");
    const target = options.target();
    const controller = new AbortController();
    samples = [];
    operation = controller;
    const signal = AbortSignal.any([
      controller.signal,
      lifetime.signal,
      AbortSignal.timeout(120_000),
    ]);
    const execute = async () => {
      let usage = idleTraining().usage;
      try {
        await mutex.run(() =>
          save(
            {
              ...state,
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
        const selected = await Promise.all(
          definitions
            .filter((source) => sourceIds.includes(source.id))
            .map((source) => discoverSource(source, signal)),
        );
        discoveries = discoveries.map(
          (prior) => selected.find((item) => item.source.id === prior.source.id) ?? prior,
        );
        const messages: SourceMessage[] = [];
        const seen = new Set(state.processed);
        const sessions = new Set<string>();
        let characters = 0;
        const add = (items: SourceMessage[]) => {
          for (const message of items) {
            if (seen.has(message.digest)) continue;
            const sessionKey = `${message.sourceId}:${message.sessionId}`;
            if (!sessions.has(sessionKey) && sessions.size >= TWIN_LIMITS.maxSessions) continue;
            const size = message.text.length + (message.precedingAssistant?.length ?? 0);
            if (
              messages.length >= TWIN_LIMITS.maxMessages ||
              characters + size > TWIN_LIMITS.maxInputCharacters
            )
              break;
            messages.push(message);
            seen.add(message.digest);
            characters += size;
            sessions.add(sessionKey);
          }
        };
        for (const source of selected) {
          signal.throwIfAborted();
          if (source.database) add(await sourceMessages(source, options.secrets(), signal));
          for (const file of source.files) {
            if (
              sessions.size >= TWIN_LIMITS.maxSessions ||
              messages.length >= TWIN_LIMITS.maxMessages ||
              characters >= TWIN_LIMITS.maxInputCharacters
            )
              break;
            signal.throwIfAborted();
            try {
              add(await readSession(source, file, options.secrets(), signal));
            } catch (error) {
              signal.throwIfAborted();
              source.source.warnings.push(
                safeMemoryText(
                  `Session could not be read: ${error instanceof Error ? error.message : String(error)}`,
                  options.secrets(),
                ).slice(0, 1000),
              );
            }
          }
        }
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
        samples = messages.slice(0, 16).map((message) => ({
          sourceId: message.sourceId,
          sessionId: message.sessionId,
          quote: safeMemoryText(message.text, options.secrets()).slice(0, 4000),
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
        );
        usage = result.usage;
        signal.throwIfAborted();
        await mutex.run(async () => {
          signal.throwIfAborted();
          const known = new Set(state.entries.map((entry) => entry.id));
          const additions = result.candidates.filter((candidate) => {
            if (known.has(candidate.id)) return false;
            known.add(candidate.id);
            return true;
          });
          if (state.entries.length + additions.length > TWIN_LIMITS.maxProfileEntries)
            throw new Error("Twin profile is full. Remove obsolete traits before learning more.");
          await save(
            {
              ...state,
              enabled: state.enabled || result.candidates.length > 0,
              entries: [
                ...state.entries,
                ...additions.map((candidate) => ({
                  ...candidate,
                  revision: 1,
                  updatedAt: new Date().toISOString(),
                })),
              ],
              // ponytail: retain 5000 message hashes; add a source cursor if long-running imports exceed this bound.
              processed: [
                ...new Set([...state.processed, ...messages.map((message) => message.digest)]),
              ].slice(-5000),
              training: {
                ...state.training,
                state: "ready",
                message:
                  "Twin learned these reactions and can now represent your taste to the Worker. You can edit any trait.",
                usage,
              },
            },
            signal,
          );
        });
      } catch (error) {
        await mutex.run(async () => {
          const failed: TwinState = {
            ...state,
            training: {
              ...state.training,
              usage: error instanceof TwinInferenceError ? error.usage : usage,
              state: controller.signal.aborted || lifetime.signal.aborted ? "cancelled" : "error",
              message: safeMemoryText(
                error instanceof Error ? error.message : String(error),
                options.secrets(),
              ).slice(0, 2000),
            },
          };
          try {
            await save(failed);
          } catch (saveError) {
            state = {
              ...state,
              training: {
                ...failed.training,
                message: safeMemoryText(
                  `${failed.training.message}\nTraining status could not be saved: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
                  options.secrets(),
                ).slice(0, 2000),
              },
            };
          }
        });
      } finally {
        samples = [];
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
      if (parsed.enabled === false) {
        operation?.abort(new Error("Twin disabled by the user."));
        await pending;
      }
      return mutex.run(async () => {
        writable();
        await save({
          ...state,
          ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
          ...(parsed.sourceIds === undefined ? {} : { sourceIds: [...new Set(parsed.sourceIds)] }),
        });
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
          if (!entries.some((entry) => entry.id === accepted.id)) {
            if (entries.length >= TWIN_LIMITS.maxProfileEntries)
              throw new Error(
                "Twin profile is full. Forget an obsolete trait before adding another.",
              );
            entries = [
              ...entries,
              { ...accepted, revision: 1, updatedAt: new Date().toISOString() },
            ];
          }
        }
        await save({
          ...state,
          entries,
          candidates: state.candidates.filter((item) => item.id !== candidateId),
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
      const quote = parsed.content;
      const candidate: TwinCandidate = {
        id: memoryDigest(JSON.stringify(parsed)).slice(0, 40),
        kind: "lesson",
        reaction: parsed.reaction ?? "anger",
        strength: parsed.strength ?? 2,
        voice: parsed.voice ?? parsed.content.slice(0, 600),
        summary: parsed.summary,
        content: parsed.content,
        appliesWhen: parsed.appliesWhen,
        evidence: [
          {
            sourceId: "flecten",
            sessionId: "twin-editor",
            reference: parsed.path ?? "Twin profile editor",
            digest: memoryDigest(quote),
            quote,
          },
        ],
      };
      return mutex.run(async () => {
        writable();
        let entries = state.entries;
        if (!entries.some((entry) => entry.id === candidate.id)) {
          if (entries.length >= TWIN_LIMITS.maxProfileEntries)
            throw new Error(
              "Twin profile is full. Forget an obsolete trait before adding another.",
            );
          entries = [
            ...entries,
            { ...candidate, revision: 1, updatedAt: new Date().toISOString() },
          ];
        }
        await save({ ...state, entries });
        return get();
      });
    },
    async consult(input: unknown) {
      const { question } = TwinConsultSchema.parse(input);
      if (!state.enabled) throw new Error("Enable Twin before consulting its profile.");
      if (safeMemoryText(question, options.secrets()) !== question)
        throw new Error("Remove credentials from the question.");
      const answer = await consult(
        options.target(),
        question,
        (await get()).entries,
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)]),
      );
      return { ...answer, answer: safeMemoryText(answer.answer, options.secrets()) };
    },
    async delegate(input: TwinDelegateInput, signal: AbortSignal) {
      // Redact values so masking cannot corrupt serialized JSON quotes or escapes.
      const parsed = TwinDelegateInputSchema.parse(redactKnown(input, options.secrets()));
      if (!state.enabled) throw new Error("Twin is disabled");
      const decision = await delegate(
        options.target(),
        parsed,
        state.entries,
        AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(60_000)]),
      );
      return {
        ...decision,
        voice: safeMemoryText(decision.voice, options.secrets()),
        instructions: safeMemoryText(decision.instructions, options.secrets()),
      };
    },
    async dispose() {
      lifetime.abort();
      await pending;
    },
  };
}

export function createTwin(
  cwd: string,
  access: { config(): HarnessConfig; provider(): ModelProvider },
) {
  return projectTwin({
    cwd,
    secrets: () => configSecrets(access.config()),
    target: () => ({
      provider: access.provider(),
      model: access.config().model,
      providerId: access.config().provider,
      modalities: inputModalities(access.config()),
      price: usagePrice(access.config()),
      priceFor: sessionModelOptions(access.config(), access.provider()).priceFor,
    }),
  });
}
