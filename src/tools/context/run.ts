import description from "../../../prompts/tool-description-context.md" with { type: "text" };
import { PageToolSchema } from "../../core/pages/control";
import { defineTool } from "../types";
import { canReadSearchPath } from "../util/read-permission";

export const contextTool = defineTool({
  name: "context",
  description: description.trim(),
  schema: PageToolSchema,
  mutating: true,
  execute: async (args, context) =>
    context.contextPages
      ? context.contextPages.execute(args, (path) => canReadSearchPath(context, path, "context"))
      : {
          ok: false,
          output: "",
          error: "Logical page control is unavailable in this execution scope.",
        },
});
