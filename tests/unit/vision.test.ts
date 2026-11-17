import { expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { hasVision } from "../../shared/vision";
import { visionOptions, visionTarget } from "../../src/app/vision";
import { HarnessConfigSchema } from "../../src/config/schema";
import { imageMediaType } from "../../src/core/image";
import { readTool } from "../../src/tools/read/tool";
import { appendImageMentions, imageMentions } from "../../ui/src/lib/composer/images";
import {
  PROMPT_CLIPBOARD_TYPE,
  readPromptClipboard,
} from "../../ui/src/lib/composer/prompt-clipboard";
import { promptContent, promptSnapshot } from "../../ui/src/lib/composer/prompt-document";
import { promptExtensions } from "../../ui/src/lib/composer/prompt-schema";

function config() {
  return HarnessConfigSchema.parse({
    provider: "p",
    model: "blind",
    providers: {
      p: {
        protocol: "openai-chat",
        baseUrl: "https://example.invalid/v1",
        models: {
          blind: { vision: false },
          generator: {
            vision: true,
            modalities: { output: ["image"] },
            cost: { input: 0, output: 0 },
          },
          expensive: { modalities: { input: ["image"] }, cost: { input: 2, output: 4 } },
          cheap: { vision: true, tools: false, cost: { input: 0.1, output: 0.2 } },
          freeDisabled: { vision: true, disabled: true, cost: { input: 0, output: 0 } },
          unknownPrice: { vision: true },
          falseOverride: {
            vision: false,
            modalities: { input: ["image"] },
            cost: { input: 0, output: 0 },
          },
        },
      },
      other: {
        protocol: "gemini",
        baseUrl: "https://example.invalid",
        models: { eyes: { vision: true } },
      },
    },
  });
}

test("vision selection uses explicit capabilities and prices, with a configurable cross-provider override", () => {
  const selected = config();
  expect(visionTarget(selected)).toEqual({ provider: "p", model: "cheap" });
  selected.vision = { provider: "other", model: "eyes" };
  expect(visionTarget(selected)).toEqual({ provider: "other", model: "eyes" });
  selected.vision = { provider: "other", model: "" };
  expect(() => visionTarget(selected)).toThrow("No priced vision model");
  expect(hasVision({ vision: false, modalities: { input: ["image"] } })).toBe(false);
  expect(readTool(true).parameters.properties).toHaveProperty("focus");
  expect(readTool().parameters.properties).not.toHaveProperty("focus");
  expect(
    HarnessConfigSchema.safeParse({ ...selected, vision: { provider: "p", model: "blind" } })
      .success,
  ).toBe(false);
  const vision = { provider: "", model: "", reasoning: "high", variant: "careful" } as const;
  expect(HarnessConfigSchema.parse({ ...selected, vision }).vision).toEqual(vision);
  expect(
    HarnessConfigSchema.safeParse({ ...selected, vision: { ...vision, reasoning: "deep" } })
      .success,
  ).toBe(false);
  expect(
    HarnessConfigSchema.safeParse({
      ...selected,
      vision: { provider: "p", model: "cheap", variant: "missing" },
    }).success,
  ).toBe(false);
});

test("image inspections forward their own reasoning and variant and cache each effective choice", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push((await request.json()) as Record<string, unknown>);
      const response = {
        choices: [{ delta: { content: "The image contains a chart." }, finish_reason: "stop" }],
      };
      return new Response(`data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  try {
    const selected = config();
    selected.reasoning = "max";
    selected.variant = "parent";
    const provider = selected.providers.p;
    if (!provider) throw new Error("Missing fixture provider");
    provider.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    const model = provider.models.cheap;
    if (!model) throw new Error("Missing fixture model");
    Object.assign(model, {
      reasoning: true,
      reasoningMode: "effort",
      reasoningLevels: ["low", "high", "max"],
      compat: { thinkingParam: "thinking" },
      variants: {
        careful: { body: { marker: "careful" }, maxOutputTokens: 512 },
        quick: { body: { marker: "quick" }, maxOutputTokens: 256 },
      },
    });
    selected.vision = { provider: "p", model: "cheap", reasoning: "high", variant: "careful" };
    const options = visionOptions(selected);
    const inspect = (focus?: string) =>
      options.describe(
        { mediaType: "image/png", data: "AA==" },
        focus,
        new AbortController().signal,
        () => {},
      );
    expect(await inspect()).toBe("The image contains a chart.");
    expect(requests[0]).toMatchObject({
      model: "cheap",
      reasoning_effort: "high",
      marker: "careful",
      max_tokens: 512,
    });
    await inspect();
    expect(requests).toHaveLength(1);

    selected.vision.reasoning = "low";
    await inspect();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ reasoning_effort: "low", marker: "careful" });

    selected.vision.variant = "quick";
    await inspect();
    expect(requests).toHaveLength(3);
    expect(requests[2]).toMatchObject({
      reasoning_effort: "low",
      marker: "quick",
      max_tokens: 256,
    });

    selected.vision = { provider: "", model: "", reasoning: "high", variant: "careful" };
    await inspect("Auto selection");
    expect(requests).toHaveLength(4);
    expect(requests[3]).toMatchObject({
      model: "cheap",
      reasoning_effort: "high",
      marker: "careful",
    });

    selected.vision = { provider: "", model: "" };
    await inspect();
    expect(requests).toHaveLength(5);
    expect(requests[4]).not.toHaveProperty("reasoning_effort");
    expect(requests[4]).not.toHaveProperty("marker");
    expect(requests[4]).toMatchObject({ thinking: { type: "disabled" } });
    selected.vision.variant = "missing";
    await expect(inspect()).rejects.toThrow("Choose a variant");
    expect(requests).toHaveLength(5);
  } finally {
    server.stop(true);
  }
});

test("image chips survive document and clipboard round trips and remain tied to actual paths", () => {
  const file = { path: "/tmp/screens/screen.png", name: "screen.png", kind: "image", size: 200 };
  const files = [file];
  const images = imageMentions(files, []);
  expect(images[0]?.label).toBe("Image 1");
  const snapshot = appendImageMentions({ text: "Inspect this", mentions: [] }, images);
  const schema = getSchema(promptExtensions);
  expect(
    promptSnapshot(schema.nodeFromJSON(promptContent(snapshot.text, snapshot.mentions))),
  ).toEqual(snapshot);
  expect(readPromptClipboard(JSON.stringify(snapshot), snapshot.text)).toEqual(snapshot);
  expect(PROMPT_CLIPBOARD_TYPE).toBe("application/x-flecten-prompt");
  expect(imageMentions(files, snapshot.mentions)).toEqual([]);
  const second = imageMentions([{ ...file, path: "/tmp/another.png" }], snapshot.mentions);
  expect(second[0]?.label).toBe("Image 2");
  expect(imageMediaType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
  expect(imageMediaType(Buffer.from("a text file.png"))).toBeUndefined();
});

test("cancelled image inspection never starts a provider request", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(
    visionOptions(config()).describe(
      { mediaType: "image/png", data: "" },
      undefined,
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow("cancelled");
});
