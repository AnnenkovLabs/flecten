import { z } from "zod";
import explorePrompt from "../../../prompts/subagents/explore.md" with { type: "text" };
import implementPrompt from "../../../prompts/subagents/implement.md" with { type: "text" };
import reviewPrompt from "../../../prompts/subagents/review.md" with { type: "text" };
import type { SubagentSpec } from "./types";

const exploreResult = z
  .object({
    summary: z.string().min(1),
    files: z.array(z.string()),
    findings: z.array(z.string()),
    openQuestions: z.array(z.string()),
  })
  .strict();

const implementResult = z
  .object({
    summary: z.string().min(1),
    filesChanged: z.array(z.string()),
    testsRun: z.array(z.string()),
    blockers: z.array(z.string()),
  })
  .strict();

const reviewResult = z
  .object({
    verdict: z.enum(["pass", "fail"]),
    findings: z.array(
      z
        .object({
          severity: z.enum(["low", "medium", "high"]),
          message: z.string().min(1),
          file: z.string().optional(),
          line: z.number().int().positive().optional(),
        })
        .strict(),
    ),
    evidence: z.array(z.string()),
  })
  .strict();

export const exploreSubagent: SubagentSpec = {
  id: "explore",
  name: "Explore",
  description: "Read-only reconnaissance: maps files, traces code and collects external facts.",
  systemPrompt: explorePrompt.trim(),
  allowedTools: ["read", "grep", "glob", "lsp", "web_fetch"],
  permissions: [
    { action: "read", policy: "allow" },
    { action: "network", policy: "allow", note: "web_fetch only" },
    { action: "write", policy: "deny" },
    { action: "shell", policy: "deny" },
  ],
  budget: { maxTurns: 12, maxTokens: 24_000 },
  resultSchema: exploreResult,
};

export const implementSubagent: SubagentSpec = {
  id: "implement",
  name: "Implement",
  description: "Changes code, runs checks and reports exactly what changed.",
  systemPrompt: implementPrompt.trim(),
  allowedTools: [
    "read",
    "grep",
    "glob",
    "write",
    "edit",
    "apply_patch",
    "delete",
    "move",
    "bash",
    "terminal",
    "jobs",
    "todo",
    "git",
  ],
  permissions: [
    { action: "read", policy: "allow" },
    { action: "write", policy: "allow" },
    { action: "shell", policy: "allow" },
    { action: "network", policy: "deny" },
  ],
  budget: { maxTurns: 40, maxTokens: 96_000 },
  resultSchema: implementResult,
};

export const reviewSubagent: SubagentSpec = {
  id: "review",
  name: "Review",
  description: "Read-only review of a diff or change with a pass or fail verdict.",
  systemPrompt: reviewPrompt.trim(),
  allowedTools: ["read", "grep", "glob", "git", "lsp"],
  permissions: [
    { action: "read", policy: "allow" },
    { action: "shell", policy: "deny" },
    { action: "shell", tool: "git", policy: "allow", note: "read-only git commands" },
    { action: "write", policy: "deny" },
  ],
  budget: { maxTurns: 20, maxTokens: 48_000 },
  resultSchema: reviewResult,
};

export const builtinSubagentSpecs: readonly SubagentSpec[] = [
  exploreSubagent,
  implementSubagent,
  reviewSubagent,
];
