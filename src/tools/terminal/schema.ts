import { z } from "zod";

export const terminalSpec = {
  name: "terminal",
  description:
    "Use persistent interactive PTY tabs when commands need interactive stdin, live terminal visibility, or shell state across calls. Each distinct id opens its own live tab in the user's Terminal panel so you can run separate terminals in parallel (e.g., id='dev-server', id='tests') while the user can watch or type into any tab directly. Prefer grep, glob and read for code search and file inspection, bash for one-shot commands, and bash background=true with jobs for simple background logs. run waits for command completion; a nonzero exit is a failed result. A wait timeout leaves the process running: inspect with read, send input with write, or stop it with kill. write sends literal input, read returns scrollback, resize changes PTY dimensions, and list shows terminal ids.",
  schema: z
    .object({
      op: z.enum(["run", "write", "read", "resize", "kill", "list"]).describe("Operation"),
      id: z.string().min(1).optional().describe("Terminal tab id, default 'default'"),
      title: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe("Optional human-readable label for the terminal tab"),
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
