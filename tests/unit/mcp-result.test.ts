import { expect, test } from "bun:test";
import { mcpResult } from "../../src/mcp/tools";

test("MCP errors keep structured recovery data out of the user-facing message", () => {
  const structuredContent = { state: "human", history: [{ action: "click" }] };
  const result = mcpResult(
    {
      isError: true,
      content: [{ type: "text", text: "The human has control. Wait for Resume agent." }],
      structuredContent,
    },
    "computer",
    "act",
  );
  expect(result.ok).toBe(false);
  expect(result.error).toBe("The human has control. Wait for Resume agent.");
  expect(result.output).toContain("Structured result:");
  expect(result.data).toMatchObject({ structuredContent });
});
