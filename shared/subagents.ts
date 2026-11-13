import { z } from "zod";

const names = ["Milo", "Lumi", "Pip", "Kiki", "Nori", "Bobo"] as const;
export function subagentIdentity(index: number): { name: string; avatar: number } {
  const cycle = Math.floor(index / names.length);
  return {
    name: `${names[index % names.length]}${cycle ? ` ${cycle + 1}` : ""}`,
    avatar: index % names.length,
  };
}

export const SubagentInfoSchema = z.object({
  id: z.string().min(1),
  callId: z.string().min(1),
  name: z.string().min(1),
  avatar: z.number().int().min(0).max(5),
  agent: z.string().min(1),
  prompt: z.string(),
});
export type SubagentInfo = z.infer<typeof SubagentInfoSchema>;
export const SubagentResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  usage: z.object({
    input: z.number(),
    output: z.number(),
    cached: z.number(),
    cost: z.number().optional(),
    reasoning: z.number().optional(),
    cacheWrite: z.number().optional(),
  }),
});
export type SubagentResult = z.infer<typeof SubagentResultSchema>;
export type SubagentEnvelope<T> =
  | { type: "subagent.started"; sessionId: string; subagent: SubagentInfo }
  | { type: "subagent.event"; sessionId: string; id: string; event: T }
  | {
      type: "subagent.finished";
      sessionId: string;
      id: string;
      result: SubagentResult;
      cancelled: boolean;
    };
