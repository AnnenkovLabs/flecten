import { z } from "zod";
import type { TabId } from "./types";

export type SubagentTab = `subagent:${string}`;
export type ModuleTab = `module:${string}:${string}`;
export type WorkspaceSurface = "thread" | TabId | SubagentTab | ModuleTab;
export const WORKSPACE_LAYOUT_KEY = "liquid.workspace-layout";
const layoutSchema = z.enum(["focus", "split"]);

/** Keep a readable conversation beside a useful review pane, including when the sidebar is open. */
export function canSplitWorkspace(width: number, sidebarWidth: number): boolean {
  return width - sidebarWidth >= 1000;
}

export class Workspace {
  surface = $state<WorkspaceSurface>("thread");
  panel = $state<TabId>("changes");
  layout = $state<"focus" | "split">("focus");

  restore(value: unknown): void {
    const parsed = layoutSchema.safeParse(value);
    if (parsed.success) this.layout = parsed.data;
  }

  select(surface: WorkspaceSurface): void {
    this.surface = surface;
    if (surface !== "thread" && !surface.startsWith("subagent:") && !surface.startsWith("module:"))
      this.panel = surface as TabId;
  }

  toggleSplit(): void {
    if (this.surface.startsWith("subagent:") || this.surface.startsWith("module:"))
      this.surface = this.panel;
    if (this.surface === "thread") {
      this.surface = this.panel;
      this.layout = "split";
    } else {
      this.layout = this.layout === "split" ? "focus" : "split";
    }
  }
}
