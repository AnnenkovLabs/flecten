import { runApplyPatch } from "./apply-patch/run";
import { applyPatchSpec } from "./apply-patch/schema";
import { runAsk } from "./ask/run";
import { askSpec } from "./ask/schema";
import { runBashTool } from "./bash/run";
import { bashSpec } from "./bash/schema";
import { runDelete } from "./delete/run";
import { deleteSpec } from "./delete/schema";
import { runDone } from "./done/run";
import { doneExecutionSchema, doneSpec } from "./done/schema";
import { runEdit } from "./edit/run";
import { editSpec } from "./edit/schema";
import { runGlob } from "./glob/run";
import { globSpec } from "./glob/schema";
import { runGrep } from "./grep/run";
import { grepSpec } from "./grep/schema";
import { runJobs } from "./jobs/run";
import { jobsSpec } from "./jobs/schema";
import { memoryTool } from "./memory/run";
import { runMove } from "./move/run";
import { moveSpec } from "./move/schema";
import { readTool } from "./read/tool";
import { taskTool } from "./task/run";
import { runTerminalTool } from "./terminal/run";
import { terminalSpec } from "./terminal/schema";
import { runTodo } from "./todo/run";
import { todoSpec } from "./todo/schema";
import { defineTool, type Tool } from "./types";
import { runWebFetch, runWebSearch } from "./web/run";
import { webFetchSpec, webSearchSpec } from "./web/schema";
import { runWrite } from "./write/run";
import { writeSpec } from "./write/schema";

export function builtinTools(imageFocus = false): Tool[] {
  return [
    memoryTool,
    readTool(imageFocus),
    defineTool({ ...writeSpec, mutating: true, execute: runWrite }),
    defineTool({ ...editSpec, mutating: true, execute: runEdit }),
    defineTool({ ...applyPatchSpec, mutating: true, execute: runApplyPatch }),
    defineTool({ ...deleteSpec, mutating: true, execute: runDelete }),
    defineTool({ ...moveSpec, mutating: true, execute: runMove }),
    defineTool({ ...todoSpec, mutating: true, execute: runTodo }),
    taskTool,
    defineTool({
      ...grepSpec,
      provenance: (args) => ({ source: "file", ref: args.path ?? "." }),
      execute: runGrep,
    }),
    defineTool({ ...globSpec, execute: runGlob }),
    defineTool({ ...askSpec, execute: runAsk }),
    defineTool({
      ...webFetchSpec,
      provenance: (args) => ({ source: "web", ref: args.url }),
      execute: runWebFetch,
    }),
    defineTool({
      ...webSearchSpec,
      provenance: (args) => ({ source: "web", ref: args.query }),
      execute: runWebSearch,
    }),
    defineTool({
      ...terminalSpec,
      mutating: true,
      timeoutMs: (args) => (args.op === "run" ? (args.timeoutMs ?? 600_000) + 10_000 : 30_000),
      provenance: (args) => ({
        source: "shell",
        ...(args.command ? { ref: args.command } : { ref: `terminal ${args.id ?? "default"}` }),
      }),
      execute: runTerminalTool,
    }),
    defineTool({
      ...bashSpec,
      mutating: true,
      timeoutMs: (args) => (args.timeoutMs ? args.timeoutMs + 10_000 : 600_000),
      provenance: (args) => ({ source: "shell", ref: args.command }),
      execute: runBashTool,
    }),
    defineTool({
      ...jobsSpec,
      timeoutMs: (args) => (args.timeoutMs ?? 600_000) + 10_000,
      provenance: (args) => ({ source: "shell", ref: `job ${args.id ?? args.op}` }),
      execute: runJobs,
    }),
    {
      ...defineTool({ ...doneSpec, mutating: true, execute: runDone }),
      schema: doneExecutionSchema,
    },
  ];
}
