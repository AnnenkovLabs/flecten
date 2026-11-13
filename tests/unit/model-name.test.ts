import { describe, expect, test } from "bun:test";
import { formatModelName } from "../../ui/src/lib/model-name";

describe("ui model names", () => {
  test("formats ids the same way as the catalog", () => {
    expect(formatModelName("glm-5.3-prime")).toBe("GLM 5.3 Prime");
    expect(formatModelName("claude-3.5-haiku")).toBe("Claude 3.5 Haiku");
    expect(formatModelName("claude-sonnet-4-5")).toBe("Claude Sonnet 4.5");
    expect(formatModelName("kimi-k2-6")).toBe("Kimi K2.6");
    expect(formatModelName("gpt-oss-120b")).toBe("GPT OSS 120B");
  });
});
