import { expect, test } from "bun:test";
import { modelCapabilities } from "../../ui/src/lib/model-capabilities";

test("picker capabilities use declared input support and respect explicit overrides", () => {
  expect(
    modelCapabilities({
      reasoning: true,
      modalities: { input: ["image", "pdf", "audio"] },
    }).map(({ label }) => label),
  ).toEqual(["Рассуждения", "Изображения", "PDF", "Аудио"]);
  expect(
    modelCapabilities({
      vision: false,
      pdf: false,
      audio: false,
      modalities: { input: ["image", "pdf", "audio"] },
    }),
  ).toEqual([]);
  expect(modelCapabilities({ modalities: { output: ["image", "audio"] } })).toEqual([]);
});
