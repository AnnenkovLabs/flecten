import { createHash } from "node:crypto";
import visionPrompt from "../../prompts/vision.md" with { type: "text" };
import { canDescribeImages } from "../../shared/vision";
import type { HarnessConfig } from "../config/schema";
import type { VisionOptions } from "../core/vision";
import { createProvider } from "../providers/registry";
import { costOf, maxOutputTokens } from "./provider-state";

export function visionTarget(config: HarnessConfig): { provider: string; model: string } {
  const provider = config.vision?.provider || config.provider;
  const definition = config.providers[provider];
  if (!definition) throw new Error("Choose an image description provider in Settings.");
  const selected = config.vision?.model;
  if (selected) {
    const model = definition.models[selected];
    if (!model || model.disabled || !canDescribeImages(model))
      throw new Error("Choose a model with image input in Settings.");
    return { provider, model: selected };
  }
  const candidates = Object.entries(definition.models).flatMap(([id, model]) =>
    !model.disabled && canDescribeImages(model) && model.cost
      ? [{ id, price: model.cost.input + model.cost.output }]
      : [],
  );
  candidates.sort((left, right) => left.price - right.price || left.id.localeCompare(right.id));
  const model = candidates[0]?.id;
  if (!model)
    throw new Error(
      "No priced vision model is available for this provider. Select an image description model in Settings.",
    );
  return { provider, model };
}

/** Descriptions are bounded and shared across turns; failed or cancelled requests are never cached. */
export function visionOptions(config: HarnessConfig): VisionOptions {
  const cache = new Map<string, string>();
  return {
    async describe(image, focus, signal, onUsage) {
      signal.throwIfAborted();
      const target = visionTarget(config);
      const reasoning = config.vision?.reasoning ?? "none";
      const variant = config.vision?.variant;
      const model = config.providers[target.provider]?.models[target.model];
      if (variant && !model?.variants?.[variant])
        throw new Error("Choose a variant available for the image description model in Settings.");
      const key = createHash("sha256")
        .update(image.data)
        .update(JSON.stringify([image.mediaType, target, reasoning, variant, focus]))
        .digest("hex");
      const cached = cache.get(key);
      if (cached) return cached;
      const selected = {
        ...config,
        ...target,
        variant,
        reasoning,
        failover: { enabled: false, providers: [] },
      };
      const { provider } = createProvider(selected);
      let description = "";
      let complete = false;
      const started = Date.now();
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      let reported = false;
      let requested = true;
      try {
        for await (const event of provider.stream(
          {
            model: target.model,
            ...(reasoning ? { reasoning } : {}),
            ...(variant ? { variant } : {}),
            system: visionPrompt,
            tools: [],
            maxTokens: Math.min(4096, maxOutputTokens(selected)),
            messages: [
              {
                role: "user",
                content: focus ? `Inspection focus:\n${focus}` : "Describe this image in detail.",
                images: [image],
              },
            ],
          },
          timeout,
        )) {
          if (event.type === "text") {
            description += event.delta;
            if (description.length > 60_000)
              throw new Error("Image description exceeded its limit.");
          } else if (event.type === "usage") {
            reported = true;
            onUsage({
              usage: {
                input: event.input,
                output: event.output,
                cached: event.cached,
                ...(event.cacheWrite === undefined ? {} : { cacheWrite: event.cacheWrite }),
              },
              ...target,
              price: (usage) => costOf(usage, model, variant),
              durationMs: Date.now() - started,
            });
          } else if (event.type === "response") requested = event.response.requested !== false;
          else if (event.type === "done") complete = event.reason === "end";
        }
      } finally {
        if (!reported && requested)
          onUsage({
            usage: { input: 0, output: 0, cached: 0 },
            reported: false,
            ...target,
            price: (usage) => costOf(usage, model, variant),
            durationMs: Date.now() - started,
          });
      }
      timeout.throwIfAborted();
      if (!complete || !description.trim())
        throw new Error(
          "Image description was incomplete. Retry or choose another vision model in Settings.",
        );
      const oldest = cache.keys().next().value;
      if (cache.size >= 64 && oldest) cache.delete(oldest);
      cache.set(key, description);
      return description;
    },
  };
}
