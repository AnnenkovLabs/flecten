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
import { configSecrets } from "./provider-secrets";
import { inputModalities } from "./service-policy";
import { usagePrice } from "./session-config";

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
  const writable = () => {
    if (loadError) throw new Error(loadError);
  };
  const save = () => {
    writable();
    return store.save(state);
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
      training:
        operation && !["reading", "learning"].includes(state.training.state)
          ? { ...state.training, state: "learning" }
          : state.training,
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
    const controller = new AbortController();
    operation = controller;
    const signal = AbortSignal.any([
      controller.signal,
      lifetime.signal,
      AbortSignal.timeout(120_000),
    ]);
    const target = options.target();
    state.sourceIds = [...new Set(sourceIds)];
    state.training = {
      ...idleTraining(),
      state: "reading",
      provider: target.providerId,
      model: target.model,
    };
    const execute = async () => {
      try {
        await save();
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
        let sessionFiles = 0;
        for (const source of selected) {
          signal.throwIfAborted();
          if (source.database) add(await sourceMessages(source, options.secrets(), signal));
          for (const file of source.files) {
            if (
              sessionFiles >= TWIN_LIMITS.maxSessions ||
              messages.length >= TWIN_LIMITS.maxMessages ||
              characters >= TWIN_LIMITS.maxInputCharacters
            )
              break;
            signal.throwIfAborted();
            sessionFiles += 1;
            try {
              add(await readSession(source, file, options.secrets(), signal));
            } catch (error) {
              signal.throwIfAborted();
              source.source.warnings.push(
                `Session could not be read: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
        signal.throwIfAborted();
        state.training.sessions = sessions.size;
        state.training.messages = messages.length;
        if (!messages.length) {
          state.training = {
            ...state.training,
            state: "ready",
            message: "No new supported user messages were found. No model request was made.",
          };
          await save();
          return;
        }
        state.training.state = "learning";
        await save();
        const snapshot = await get();
        const result = await learn(
          target,
          messages,
          [...snapshot.entries, ...state.candidates],
          options.secrets(),
          signal,
        );
        signal.throwIfAborted();
        await mutex.run(async () => {
          signal.throwIfAborted();
          const additions = result.candidates.filter(
            (candidate) => !state.entries.some((prior) => prior.id === candidate.id),
          );
          if (state.entries.length + additions.length > TWIN_LIMITS.maxProfileEntries)
            throw new Error("Twin profile is full. Remove obsolete traits before learning more.");
          state.entries.push(
            ...additions.map((candidate) => ({
              ...candidate,
              revision: 1,
              updatedAt: new Date().toISOString(),
            })),
          );
          // ponytail: retain 5000 message hashes; add a source cursor if long-running imports exceed this bound.
          state.processed = [
            ...new Set([...state.processed, ...messages.map((message) => message.digest)]),
          ].slice(-5000);
          state.training = {
            ...state.training,
            state: "ready",
            message:
              "Twin learned these reactions and can now represent your taste to the Worker. You can edit any trait.",
            usage: result.usage,
          };
          if (result.candidates.length) state.enabled = true;
          await save();
        });
      } catch (error) {
        state.training = {
          ...state.training,
          ...(error instanceof TwinInferenceError ? { usage: error.usage } : {}),
          state: controller.signal.aborted || lifetime.signal.aborted ? "cancelled" : "error",
          message: safeMemoryText(
            error instanceof Error ? error.message : String(error),
            options.secrets(),
          ).slice(0, 2000),
        };
        await save();
      } finally {
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
        Object.assign(entry, parsed.edits, {
          revision: entry.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        await save();
        return get();
      });
    },
    async configure(input: unknown) {
      const parsed = TwinConfigureSchema.parse(input);
      return mutex.run(async () => {
        writable();
        if (parsed.enabled !== undefined) state.enabled = parsed.enabled;
        if (parsed.sourceIds !== undefined) state.sourceIds = [...new Set(parsed.sourceIds)];
        await save();
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
        if (action === "accept") {
          const accepted = TwinCandidateSchema.parse({ ...candidate, ...edits });
          if (
            safeMemoryText(JSON.stringify(accepted), options.secrets()) !== JSON.stringify(accepted)
          )
            throw new Error("Remove credentials before saving a preference.");
          if (state.entries.length >= TWIN_LIMITS.maxProfileEntries)
            throw new Error(
              "Twin profile is full. Forget an obsolete trait before adding another.",
            );
          if (!state.entries.some((entry) => entry.id === accepted.id))
            state.entries.push({ ...accepted, revision: 1, updatedAt: new Date().toISOString() });
        }
        state.candidates = state.candidates.filter((item) => item.id !== candidateId);
        await save();
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
        state.entries = state.entries.filter((entry) => entry.id !== id);
        await save();
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
            sourceId: "liquid",
            sessionId: "twin-editor",
            reference: parsed.path ? `Twin correction: ${parsed.path}` : "Twin profile editor",
            digest: memoryDigest(quote),
            quote,
          },
        ],
      };
      return mutex.run(async () => {
        writable();
        if (state.entries.length >= TWIN_LIMITS.maxProfileEntries)
          throw new Error("Twin profile is full. Forget an obsolete trait before adding another.");
        if (!state.entries.some((entry) => entry.id === candidate.id))
          state.entries.push({ ...candidate, revision: 1, updatedAt: new Date().toISOString() });
        await save();
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
      const parsed = TwinDelegateInputSchema.parse(
        JSON.parse(safeMemoryText(JSON.stringify(input), options.secrets())),
      );
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
    }),
  });
}
