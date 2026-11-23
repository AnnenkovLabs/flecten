import { z } from "zod";

export const TerminalOwnerSchema = z.enum(["user", "agent"]);
export type TerminalOwner = z.infer<typeof TerminalOwnerSchema>;

export const TerminalProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  shell: z.string().min(1),
  isDefault: z.boolean(),
});
export type TerminalProfile = z.infer<typeof TerminalProfileSchema>;

export const TerminalTabInfoSchema = z.object({
  id: z.string().min(1),
  ptyId: z.string().min(1),
  owner: TerminalOwnerSchema,
  sessionId: z.string().optional(),
  role: z.enum(["talker", "worker"]).optional(),
  title: z.string(),
  shell: z.string(),
  shellName: z.string(),
  cwd: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  running: z.boolean(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
});
export type TerminalTabInfo = z.infer<typeof TerminalTabInfoSchema>;

export const TerminalStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("terminal.tabs"),
    tabs: z.array(TerminalTabInfoSchema),
    profiles: z.array(TerminalProfileSchema),
  }),
  z.object({
    type: z.literal("terminal.data"),
    id: z.string().min(1),
    data: z.string(),
    cursor: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("terminal.exit"),
    id: z.string().min(1),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
  z.object({
    type: z.literal("terminal.error"),
    id: z.string().min(1),
    message: z.string(),
  }),
]);
export type TerminalStreamEvent = z.infer<typeof TerminalStreamEventSchema>;

export const IdeTerminalActionSchema = z.enum([
  "list",
  "create",
  "read",
  "write",
  "resize",
  "rename",
  "restart",
  "stop",
  "close",
]);
export type IdeTerminalAction = z.infer<typeof IdeTerminalActionSchema>;

export const IdeTerminalInputSchema = z.object({
  action: IdeTerminalActionSchema,
  id: z.string().min(1).max(200).optional(),
  shell: z.string().min(1).max(500).optional(),
  cwd: z.string().min(1).max(1000).optional(),
  title: z.string().max(120).optional(),
  data: z.string().max(65536).optional(),
  cursor: z.number().int().nonnegative().default(0),
  cols: z.number().int().min(10).max(500).default(100),
  rows: z.number().int().min(2).max(200).default(24),
  noReply: z.boolean().optional(),
});
export type IdeTerminalInput = z.infer<typeof IdeTerminalInputSchema>;

export const IdeTerminalResponseSchema = z.object({
  data: z.string(),
  cursor: z.number().int().nonnegative(),
  epoch: z.number().int(),
  reset: z.boolean(),
  running: z.boolean(),
  tab: TerminalTabInfoSchema.optional(),
  tabs: z.array(TerminalTabInfoSchema).optional(),
  profiles: z.array(TerminalProfileSchema).optional(),
});
export type IdeTerminalResponse = z.infer<typeof IdeTerminalResponseSchema>;

export type IdeTerminalCommand =
  | {
      type: "ide.terminal";
      requestId: string;
      action: IdeTerminalAction;
      id?: string;
      shell?: string;
      cwd?: string;
      title?: string;
      data?: string;
      cursor?: number;
      cols?: number;
      rows?: number;
      noReply?: boolean;
    }
  | {
      type: "ide.terminal";
      action: "write" | "resize";
      id?: string;
      data?: string;
      cols?: number;
      rows?: number;
      noReply: true;
    };
