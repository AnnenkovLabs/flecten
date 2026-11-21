import { join } from "node:path";
import type { TwinSnapshot } from "../../shared/twin";
import type { HarnessConfig } from "../config/schema";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import { createProvider } from "../providers/registry";
import type { ModelProvider } from "../providers/types";
import type { SourceDiscovery } from "../twin/sources";
import type { TwinState } from "../twin/state";
import { mergeTwinAdditions } from "../twin/state";
import { configSecrets } from "./provider-secrets";
import { inputModalities } from "./service-policy";
import { usagePrice } from "./session-config";
import { sessionModelOptions } from "./session-model-options";
import { validateModelChoice, withModelChoice } from "./session-models";
import { projectTwin } from "./twin";

export function toolAllowedRoots(selected: readonly SourceDiscovery[]): string[] {
  const subdirs = [
    ".commandcode",
    ".claude",
    ".codex",
    ".omp",
    ".kilo",
    ".local/share/kilo",
    ".local/share/kilo-desktop-light/data/kilo",
    ".hermes",
  ];
  return [
    ...new Set(
      selected.flatMap((item) => {
        const home = item.home;
        return [item.source.path, ...(home ? subdirs.map((sub) => join(home, sub)) : [])];
      }),
    ),
  ];
}

export function appendTwinEntry(
  entries: TwinState["entries"],
  candidate: TwinState["candidates"][number],
  maxEntries: number,
): TwinState["entries"] {
  if (entries.some((entry) => entry.id === candidate.id)) return entries;
  if (entries.length >= maxEntries)
    throw new Error("Twin profile is full. Forget an obsolete trait before adding another.");
  return [...entries, { ...candidate, revision: 1, updatedAt: new Date().toISOString() }];
}

export function mergeTwinBatchState(
  state: TwinState,
  candidates: TwinState["candidates"],
  digests: readonly string[],
  usage: TwinSnapshot["training"]["usage"],
  maxEntries: number,
  markReady: boolean,
): TwinState {
  const merged = mergeTwinAdditions(state, candidates, digests, maxEntries, markReady);
  return {
    ...state,
    enabled: state.enabled || merged.accepted.length > 0,
    entries: merged.entries,
    candidates: merged.candidates,
    processed: merged.processed,
    training: {
      ...state.training,
      usage,
      ...(markReady
        ? {
            state: "ready" as const,
            message:
              "Twin learned these reactions and can now represent your taste to the Worker. You can edit any trait.",
          }
        : {}),
    },
  };
}

export function saveTwinFailure(
  error: unknown,
  usage: TwinSnapshot["training"]["usage"],
  aborted: boolean,
  secrets: readonly string[],
  state: TwinState,
  errorClass: abstract new (...args: never[]) => { usage: TwinSnapshot["training"]["usage"] },
): TwinState {
  const message = safeMemoryText(
    error instanceof Error ? error.message : String(error),
    secrets,
  ).slice(0, 2000);
  return {
    ...state,
    training: {
      ...state.training,
      usage: error instanceof errorClass ? error.usage : usage,
      state: aborted ? "cancelled" : "error",
      message,
    },
  };
}

export function persistTwinFailure(
  error: unknown,
  usage: TwinSnapshot["training"]["usage"],
  aborted: boolean,
  secrets: readonly string[],
  state: TwinState,
  errorClass: abstract new (...args: never[]) => { usage: TwinSnapshot["training"]["usage"] },
  save: (next: TwinState) => Promise<void>,
  fallback: (next: TwinState) => void,
): Promise<void> {
  const failed = saveTwinFailure(error, usage, aborted, secrets, state, errorClass);
  return save(failed).catch((saveError) => {
    const detail = saveError instanceof Error ? saveError.message : String(saveError);
    fallback({
      ...state,
      training: {
        ...failed.training,
        message: safeMemoryText(
          `${failed.training.message}\nTraining status could not be saved: ${detail}`,
          secrets,
        ).slice(0, 2000),
      },
    });
  });
}

export function buildObserveMessage(
  sessionId: string,
  text: string,
  secrets: readonly string[],
  processed: readonly string[],
  precedingAssistant?: string,
  reference?: string,
) {
  const trimmed = text.trim();
  const digest = memoryDigest(trimmed);
  if (
    trimmed.length < 12 ||
    trimmed.length > 16_000 ||
    safeMemoryText(trimmed, secrets) !== trimmed ||
    processed.includes(digest)
  )
    return undefined;
  const preceding = precedingAssistant
    ? safeMemoryText(precedingAssistant.slice(-4000), secrets)
    : undefined;
  return {
    digest,
    message: {
      id: `source-flecten-${digest.slice(0, 24)}`,
      sourceId: "flecten" as const,
      sessionId: memoryDigest(sessionId).slice(0, 32),
      reference: reference ?? `session:${sessionId}`,
      text: trimmed,
      digest,
      ...(preceding ? { precedingAssistant: preceding } : {}),
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
    validateChoice: (choice) => validateModelChoice(access.config(), choice),
    target: (choice) => {
      const base = access.config();
      const effective = choice ? withModelChoice(base, choice) : base;
      const provider = choice ? createProvider(effective).provider : access.provider();
      return {
        provider,
        model: effective.model,
        providerId: effective.provider,
        ...(effective.reasoning ? { reasoning: effective.reasoning } : {}),
        ...(effective.variant ? { variant: effective.variant } : {}),
        cwd,
        modalities: inputModalities(effective),
        price: usagePrice(effective),
        priceFor: sessionModelOptions(effective, provider).priceFor,
      };
    },
  });
}
