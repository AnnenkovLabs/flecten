import { askSpec } from "../tools/ask/schema";
import type { Tool } from "../tools/types";

/** The representative may answer taste questions. Permission decisions retain their own gate. */
export function twinQuestion(
  tool: Tool,
  answer: (question: string, signal: AbortSignal) => Promise<string | undefined>,
): Tool {
  return {
    ...tool,
    async execute(input, context) {
      const args = askSpec.schema.parse(input);
      const response = await answer(
        `${args.question}\nOptions: ${JSON.stringify(args.options)}`,
        context.signal,
      );
      if (context.signal.aborted)
        return { ok: false, output: "", error: "Twin question cancelled" };
      if (response)
        return {
          ok: true,
          output: response,
          data: { kind: "twin-answer", question: args.question },
        };
      return tool.execute(input, context);
    },
  };
}
