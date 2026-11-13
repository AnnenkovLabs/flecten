import type { ModelEvent, ModelRequest } from "../../src/providers/types";

export const servers: Array<ReturnType<typeof Bun.serve>> = [];

export function request(): ModelRequest {
  return {
    model: "test-model",
    system: "system",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        name: "read",
        description: "read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
    maxTokens: 100,
  };
}

export async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const output: ModelEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

export function stopServers(): void {
  for (const server of servers.splice(0)) server.stop(true);
}
