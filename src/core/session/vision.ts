import { acceptsImages } from "../../../shared/vision";
import type { Event } from "../types";
import { addUsage } from "../types/message";
import type { InspectImage } from "../vision";
import { BUDGET_ABORT } from "./budget";
import type { SessionOptions } from "./options";
import type { ActiveRun } from "./runtime";

export function runVision(
  options: SessionOptions,
  state: ActiveRun,
  emit: (event: Event) => void,
): InspectImage | undefined {
  if (acceptsImages(options.modalities)) return undefined;
  return async (image, focus, signal) => {
    if (!options.vision)
      throw new Error("Image description is unavailable. Configure a vision model in Settings.");
    return options.vision.describe(image, focus, signal, ({ usage, price, ...target }) => {
      state.usage = addUsage(state.usage, usage);
      emit({ type: "usage", sessionId: state.sessionId, usage, purpose: "vision", ...target });
      emit({ type: "budget", sessionId: state.sessionId, budget: state.budget.add(usage, price) });
      if (state.budget.exhausted()) state.controller.abort(BUDGET_ABORT);
    });
  };
}
