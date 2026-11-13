import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  providerGlyph,
  providerLogoUrl,
  resolveProviderLogo,
} from "../../ui/src/lib/provider-glyph";
import { PROVIDER_LOGO_IDS } from "../../ui/src/lib/provider-logos.generated";

const publicDir = join(import.meta.dir, "../../ui/public");

describe("provider glyph", () => {
  test("every generated logo id has a bundled svg file", () => {
    expect(PROVIDER_LOGO_IDS.size).toBeGreaterThan(200);
    for (const id of PROVIDER_LOGO_IDS) {
      expect(existsSync(join(publicDir, providerLogoUrl(id)))).toBe(true);
    }
  });

  test("resolves catalog ids, config aliases and base urls", () => {
    expect(resolveProviderLogo("anthropic")).toBe("anthropic");
    expect(resolveProviderLogo("Gemini")).toBe("google");
    expect(resolveProviderLogo("bedrock")).toBe("amazon-bedrock");
    expect(resolveProviderLogo("my-proxy", "https://api.deepseek.com/v1")).toBe("deepseek");
    expect(resolveProviderLogo("work", "https://acme.openai.azure.com/openai")).toBe("azure");
    expect(resolveProviderLogo("local", "http://127.0.0.1:8080/v1")).toBeUndefined();
  });

  test("falls back to a stable monogram without a logo", () => {
    const glyph = providerGlyph("acme-labs", undefined, "Acme Labs");
    expect(glyph.logo).toBeUndefined();
    expect(glyph.monogram).toBe("AL");
    expect(providerGlyph("acme-labs").tone).toBe(glyph.tone);
  });
});
