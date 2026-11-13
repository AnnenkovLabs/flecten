import { describe, expect, test } from "bun:test";
import { type ContextMessage, PROFILE_4 } from "../../src/context";
import { PageWriter } from "../../src/core/pages/writer";
import { scriptedProvider } from "../helpers/fake-provider";

async function fallbackPage(messages: ContextMessage[]): Promise<string> {
  const writer = new PageWriter({
    provider: scriptedProvider([[{ type: "done", reason: "end" }]]),
    maxOutputTokens: 2000,
    contextWindow: 50_000,
  });
  await writer.write(messages, { profile: PROFILE_4, targetTokens: 4000 });
  expect(writer.last?.source).toBe("deterministic");
  return writer.last?.markdown ?? "";
}

describe("page continuation evidence", () => {
  test("failed summary generation retains the explicit completed block and its next step", async () => {
    const page = await fallbackPage([
      { role: "user", content: "Build authentication and a dashboard" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "close",
            name: "context",
            args: {
              op: "complete",
              summary: "Login and Registration verified",
              evidence: ["Authentication checks passed"],
              next: "Build only the dashboard shell",
            },
          },
        ],
      },
      { role: "tool", toolCallId: "close", name: "context", content: "Page completed" },
    ]);
    expect(page).toContain("Login and Registration verified");
    expect(page).toContain("Authentication checks passed");
    expect(page).toContain("## Next step\n- Build only the dashboard shell");
  });
  test("fallback correlates parallel results and preserves failures and unknown effects", async () => {
    const page = await fallbackPage([
      { role: "user", content: "Fix both files and run the checks" },
      {
        role: "assistant",
        content: "Both files are fixed and all checks passed",
        toolCalls: [
          { id: "failed", name: "edit", args: { path: "src/failed.ts" } },
          { id: "missing", name: "edit", args: { path: "src/missing.ts" } },
          { id: "edited", name: "edit", args: { path: "src/fixed.ts" } },
          { id: "checked", name: "bash", args: { command: "bun test" } },
        ],
      },
      { role: "tool", toolCallId: "checked", name: "bash", content: "12 pass, exit code 0" },
      {
        role: "tool",
        toolCallId: "failed",
        name: "edit",
        content: "File changed since the last read",
        isError: true,
      },
      { role: "tool", toolCallId: "edited", name: "edit", content: "Replaced one occurrence" },
    ]);
    const progress = page.split("## Where")[0] ?? "";
    expect(progress).toContain("edit src/fixed.ts returned successfully: Replaced one occurrence");
    expect(progress).toContain("bash `bun test` returned successfully: 12 pass, exit code 0");
    expect(progress).not.toContain("src/failed.ts");
    expect(progress).not.toContain("src/missing.ts");
    expect(page).toContain("edit src/failed.ts failed; effects unverified");
    expect(page).toContain(
      "edit src/missing.ts result unavailable; execution and effects unverified",
    );
    expect(page).not.toContain("Both files are fixed and all checks passed");
  });

  test("fallback retains the blocker and required next action without claiming page completion", async () => {
    const page = await fallbackPage([
      { role: "user", content: "Verify authentication" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "blocked",
            name: "context",
            args: {
              op: "block",
              summary: "Required fixture is missing",
              evidence: ["read returned ENOENT for auth.json"],
              next: "Provide auth.json before resuming verification",
            },
          },
        ],
      },
      { role: "tool", toolCallId: "blocked", name: "context", content: "Page blocked" },
    ]);
    expect(page.split("## Where")[0]).not.toContain("Required fixture is missing");
    expect(page).toContain("Unfinished logical page: Required fixture is missing");
    expect(page).toContain("read returned ENOENT for auth.json");
    expect(page).toContain("## Next step\n- Provide auth.json before resuming verification");
  });

  test("latest steering remains the next request even after an outdated assistant plan", async () => {
    const page = await fallbackPage([
      { role: "user", content: "Rename the old helper" },
      { role: "assistant", content: "I will rename every caller" },
      { role: "user", content: "Keep the public name.\nOnly fix the empty input case." },
      { role: "assistant", content: "Next I will rename every caller" },
    ]);
    const next = page.split("## Next step\n")[1]?.split("## Open risks")[0];
    expect(next).toContain("Keep the public name.\nOnly fix the empty input case.");
    expect(next).not.toContain("rename every caller");
    expect(page).toContain("## Original request (verbatim)\nRename the old helper");
  });

  test("mismatched or unidentifiable results cannot confirm a requested mutation", async () => {
    const page = await fallbackPage([
      { role: "user", content: "Edit the implementation" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "wrong-name", name: "edit", args: { path: "src/wrong.ts" } },
          { name: "write", args: { path: "src/no-id.ts" } },
        ],
      },
      { role: "tool", toolCallId: "wrong-name", name: "read", content: "contents" },
      { role: "tool", toolCallId: "orphan", name: "edit", content: "success" },
    ]);
    const progress = page.split("## Where")[0] ?? "";
    expect(progress).not.toContain("returned successfully");
    expect(page).toContain("read result has no matching call");
    expect(page).toContain("edit result has no matching call");
    expect(page).toContain("edit src/wrong.ts result unavailable");
    expect(page).toContain("write src/no-id.ts result unavailable");
  });
});
