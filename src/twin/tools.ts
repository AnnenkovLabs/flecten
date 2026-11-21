import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { safeMemoryText } from "../core/memory/sources";
import type { ToolCall, ToolResult } from "../core/types";
import type { ToolSchema } from "../providers/types";
import { runGlob } from "../tools/glob/run";
import { globSpec } from "../tools/glob/schema";
import { runGrep } from "../tools/grep/run";
import { grepSpec } from "../tools/grep/schema";
import { runRead } from "../tools/read/run";
import { readSpec } from "../tools/read/schema";
import { defineTool, type Tool } from "../tools/types";
import { ReadTracker } from "../tools/util/read-tracker";
import { markdownData } from "../util/markdown";
import type { SourceMessage } from "./sources";

export interface TwinToolOptions {
  cwd: string;
  allowedRoots?: readonly string[];
  messages?: readonly SourceMessage[];
  secrets?: readonly string[];
  maxToolTurns?: number;
}

const twinInspectMessagesTool = defineTool({
  name: "inspect_messages",
  description:
    "Inspect full user messages and their preceding assistant context from the session index by sourceMessageId or search query.",
  schema: z
    .object({
      ids: z
        .array(z.string().min(1))
        .max(24)
        .optional()
        .describe("Exact sourceMessageId values from the session index to read in full"),
      query: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Case-insensitive text filter across user reactions and assistant context"),
      limit: z.number().int().min(1).max(24).optional().describe("Maximum messages to return"),
    })
    .strict(),
  execute: async () => ({ ok: true, output: "" }),
});

export function buildTwinTools(options: TwinToolOptions | undefined): {
  specs: ToolSchema[];
  run(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
} {
  if (!options) {
    return {
      specs: [],
      async run() {
        return { ok: false, output: "", error: "Twin tools are not enabled for this request" };
      },
    };
  }
  const readToolDef = defineTool({
    ...readSpec,
    schema: readSpec.schema.omit({ focus: true }),
    provenance: (args) => ({ source: "file", ref: args.path }),
    execute: runRead,
  });
  const grepToolDef = defineTool({
    ...grepSpec,
    provenance: (args) => ({ source: "file", ref: args.path ?? "." }),
    execute: runGrep,
  });
  const globToolDef = defineTool({ ...globSpec, execute: runGlob });
  const tools: Tool[] = [
    readToolDef,
    grepToolDef,
    globToolDef,
    ...(options.messages?.length ? [twinInspectMessagesTool] : []),
  ];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const reads = new ReadTracker();
  const roots = [options.cwd, ...(options.allowedRoots ?? [])].map((root) => resolve(root));
  const secrets = options.secrets ?? [];
  const withinRoots = (candidatePath: string): boolean => {
    const resolved = isAbsolute(candidatePath)
      ? resolve(candidatePath)
      : resolve(options.cwd, candidatePath);
    return roots.some((root) => {
      const rel = relative(root, resolved);
      return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
    });
  };
  return {
    specs: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      const tool = byName.get(call.name);
      if (!tool) return { ok: false, output: "", error: `Unknown tool: ${call.name}` };
      const parsed = tool.schema.safeParse(call.args ?? {});
      if (!parsed.success) return { ok: false, output: "", error: parsed.error.message };
      if (call.name === "inspect_messages") {
        const args = parsed.data as { ids?: string[]; query?: string; limit?: number };
        const pool = options.messages ?? [];
        const needle = args.query?.toLowerCase();
        const selected = pool
          .filter((message) => {
            if (args.ids?.length && !args.ids.includes(message.id)) return false;
            if (
              needle &&
              !message.text.toLowerCase().includes(needle) &&
              !(message.precedingAssistant?.toLowerCase().includes(needle) ?? false)
            )
              return false;
            return true;
          })
          .slice(0, args.limit ?? 16);
        const output =
          selected
            .map((message) =>
              [
                ...(message.precedingAssistant
                  ? [
                      markdownData(
                        "Preceding assistant work, context only",
                        [["Reference", message.reference]],
                        safeMemoryText(message.precedingAssistant, secrets),
                      ),
                    ]
                  : []),
                markdownData(
                  "Untrusted user reaction",
                  [
                    ["Source message ID", message.id],
                    ["Source", message.sourceId],
                    ["Session", message.sessionId],
                    ["Reference", message.reference],
                  ],
                  safeMemoryText(message.text, secrets),
                ),
              ].join("\n\n"),
            )
            .join("\n\n") || "No matching messages found.";
        return { ok: true, output };
      }
      const pathArg = (parsed.data as { path?: string }).path ?? ".";
      if (!withinRoots(pathArg)) {
        return {
          ok: false,
          output: "",
          error: `Path is outside Twin's allowed directories: ${pathArg}`,
        };
      }
      const result = await tool.execute(parsed.data, {
        sessionId: "twin",
        cwd: options.cwd,
        signal,
        logDir: options.cwd,
        limits: {
          readLimitLines: 400,
          maxOutputBytes: 32_000,
          maxOutputLines: 600,
          bashTimeoutMs: 10_000,
        },
        reads,
        secrets,
      });
      return { ...result, output: safeMemoryText(result.output, secrets) };
    },
  };
}
