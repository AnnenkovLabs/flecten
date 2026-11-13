import { defineTool } from "../types";
import { runRead } from "./run";
import { readSpec } from "./schema";

export function readTool(imageFocus = false) {
  return defineTool({
    ...readSpec,
    schema: imageFocus ? readSpec.schema : readSpec.schema.omit({ focus: true }),
    provenance: (args) => ({ source: "file", ref: args.path }),
    execute: runRead,
  });
}
