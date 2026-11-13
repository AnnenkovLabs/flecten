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
  expect(PROMPT_CLIPBOARD_TYPE).toBe("application/x-liquid-prompt");
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
