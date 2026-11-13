import description from "../../prompts/tool-description-module-inspection.md" with { type: "text" };
import { ModuleInspectionActionSchema } from "../modules/actions";
import { defineTool, type Tool } from "../tools/types";

/** The Talker can discover module context, but only the Worker executes module actions. */
export function moduleInspection(tool: Tool): Tool {
  return defineTool({
    name: tool.name,
    source: "module",
    description: description.trim(),
    schema: ModuleInspectionActionSchema,
    execute: (action, context) => tool.execute(action, context),
  });
}
