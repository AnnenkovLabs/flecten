import type { ModelEvent, ModelProvider, ModelRequest } from "../../src/providers/types";

export interface ScriptedProvider extends ModelProvider {
  requests: ModelRequest[];
}

export function scriptedProvider(scripts: ModelEvent[][]): ScriptedProvider {
  const requests: ModelRequest[] = [];
  let index = 0;
  return {
    id: "scripted",
    model: "scripted-1",
    requests,
    async *stream(request) {
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const script = scripts[index] ?? [{ type: "done", reason: "end" }];
      index += 1;
      for (const event of script) yield event;
    },
  };
}
