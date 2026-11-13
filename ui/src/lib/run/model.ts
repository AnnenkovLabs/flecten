import type { AgentEvent } from "../agent-protocol";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { toast } from "../toast.svelte";
import type { AgentInfo, ReasoningChoice } from "../types";

type Response = Extract<AgentEvent, { type: "response" }>;

/** The part of the run store that model and variant choice needs. */
export interface ModelHost {
  info: AgentInfo | null;
  reasoning: ReasoningChoice;
  variant: string | undefined;
  setReasoning(value: ReasoningChoice): void;
  touchVariant(touched: boolean): void;
}

/**
 * Switches the model. The core applies it to the next run of every task; a running task
 * finishes its run on the model it started with.
 */
export async function chooseModel(host: ModelHost, provider: string, model: string): Promise<void> {
  try {
    const response = await requestAgent<Response>({
      type: "model.set",
      provider,
      model,
      ...(host.reasoning === "auto" ? {} : { reasoning: host.reasoning }),
    });
    if (response.info) host.info = response.info;
    host.variant = undefined;
    host.touchVariant(false);
    const info = response.info?.providers.find((entry) => entry.id === provider)?.models[model];
    const levels = info?.reasoningLevels;
    const reasoning = host.reasoning;
    if (info?.reasoningMode === "toggle" && reasoning !== "auto" && reasoning !== "none") {
      host.setReasoning("auto");
    } else if (reasoning !== "auto" && levels && levels.length > 0 && !levels.includes(reasoning)) {
      host.setReasoning("auto");
    }
    toast.show(t("Model: {0}", [model]));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export async function chooseVariant(host: ModelHost, value: string | undefined): Promise<void> {
  if (!host.info) return;
  const previous = host.variant;
  host.variant = value;
  host.touchVariant(true);
  try {
    const response = await requestAgent<Response>({
      type: "model.set",
      provider: host.info.provider,
      model: host.info.model,
      ...(host.reasoning === "auto" ? {} : { reasoning: host.reasoning }),
      ...(value ? { variant: value } : {}),
    });
    if (response.info) host.info = response.info;
  } catch (error) {
    host.variant = previous;
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
