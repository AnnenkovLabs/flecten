import { z } from "zod";

export const terminalSpec = {
  name: "terminal",
  description:
    "Use a persistent PTY when a command needs stdin or shell state across calls. Prefer bash for isolated commands and bash background=true with jobs for servers or long builds. run waits for command completion; a nonzero exit is a failed result. A wait timeout leaves the process running: inspect with read, send input with write, or stop it with kill. write sends literal input, read returns scrollback, resize changes PTY dimensions, and list shows terminal ids.",
  schema: z
    .object({
      op: z.enum(["run", "write", "read", "resize", "kill", "list"]).describe("Operation"),
      id: z.string().min(1).optional().describe("Terminal id, default terminal"),
      command: z.string().optional().describe("Required for run: shell command to execute"),
      input: z
        .string()
        .optional()
        .describe("Required for write: raw input; include a newline character to submit"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory when creating a terminal; existing terminals keep their cwd"),
      cols: z.number().int().positive().max(500).optional().describe("resize: columns"),
      rows: z.number().int().positive().max(300).optional().describe("resize: rows"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(600_000)
        .optional()
        .describe("run: wait timeout in milliseconds; uses terminal settings when omitted"),
    })
    .strict()
    .superRefine((args, context) => {
      if (args.op === "run" && !args.command?.trim()) {
        context.addIssue({ code: "custom", path: ["command"], message: "run needs command" });
      }
      if (args.op === "write" && args.input === undefined) {
        context.addIssue({ code: "custom", path: ["input"], message: "write needs input" });
      }
      if (args.op === "resize" && args.cols === undefined && args.rows === undefined) {
        context.addIssue({ code: "custom", path: ["cols"], message: "resize needs cols or rows" });
      }
    }),
};

export type TerminalArgs = z.infer<typeof terminalSpec.schema>;
