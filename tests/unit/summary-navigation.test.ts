import { expect, test } from "bun:test";
import { parseSummaryMessage } from "../../ui/src/lib/markdown/sanitize";
import { parseSummaryDestination } from "../../ui/src/lib/markdown/summary-navigation";
import { SETTINGS_SECTIONS } from "../../ui/src/lib/settings/sections";

test("HTML navigation resolves actual settings, panels, the model menu and encoded file locations", () => {
  for (const section of SETTINGS_SECTIONS) {
    expect(parseSummaryDestination(`flecten://settings/${section.id}`)).toEqual({
      kind: "settings",
      section: section.id,
    });
  }
  expect(parseSummaryDestination("flecten://panel/changes")).toEqual({
    kind: "panel",
    panel: "changes",
  });
  expect(parseSummaryDestination("flecten://models")).toEqual({ kind: "models" });
  expect(
    parseSummaryDestination(
      "flecten://file?path=docs%2F%D0%9C%D0%BE%D0%B9%20%D1%84%D0%B0%D0%B9%D0%BB.md&line=42",
    ),
  ).toEqual({ kind: "file", path: "docs/Мой файл.md", line: 42 });
  expect(parseSummaryDestination("flecten://file?path=README.md")).toEqual({
    kind: "file",
    path: "README.md",
  });
});

test("the frame boundary rejects commands, unknown destinations and malformed file parameters", () => {
  const envelope = {
    type: "liquid-summary",
    version: 1,
    kind: "action",
    action: "navigate",
  } as const;
  expect(parseSummaryMessage({ ...envelope, payload: "flecten://settings/mcp" })).toEqual({
    ...envelope,
    destination: { kind: "settings", section: "mcp" },
  });
  for (const payload of [
    "https://example.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "flecten://run?command=rm",
    "flecten://settings/missing",
    "flecten://panel/__proto__",
    "flecten://settings/mcp?save=true",
    "flecten://user@settings/mcp",
    "flecten://settings/mcp#x",
    "flecten://file",
    "flecten://file?path=",
    "flecten://file?path=%00",
    "flecten://file?path=a&path=b",
    "flecten://file?path=a&command=run",
    "flecten://file?path=a&line=1&line=2",
    "flecten://file?path=a&line=0",
    "flecten://file?path=a&line=1.5",
    "flecten://file?path=a&line=no",
    "flecten://file?path=a&line=1000001",
    "flecten://models?send=true",
    "x".repeat(4001),
  ]) {
    expect(parseSummaryMessage({ ...envelope, payload }), payload).toBeNull();
  }
});
