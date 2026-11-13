import { t } from "../i18n.svelte";
import { modLabel } from "../platform";
import type { EditorAction } from "./editor-actions";
export type CommandId =
  | EditorAction
  | "new-file"
  | "new-folder"
  | "open-folder"
  | "quick-open"
  | "palette"
  | "save"
  | "save-all"
  | "reload"
  | "close"
  | "close-all"
  | "close-others"
  | "reopen"
  | "previous-tab"
  | "next-tab"
  | "back"
  | "forward"
  | "go-line"
  | "search-project"
  | "toggle-files"
  | "toggle-agent"
  | "toggle-terminal"
  | "split"
  | "wrap"
  | "font-up"
  | "font-down"
  | "font-reset";
export interface IdeCommand {
  id: CommandId;
  label: string;
  group: string;
  shortcut: string;
}
const mod = modLabel;
export function ideCommands(): IdeCommand[] {
  return [
    {
      id: "new-file",
      label: t("New file"),
      group: t("File"),
      shortcut: `${mod}+N`,
    },
    {
      id: "new-folder",
      label: t("New folder"),
      group: t("File"),
      shortcut: "",
    },
    {
      id: "open-folder",
      label: t("Open project folder"),
      group: t("File"),
      shortcut: "",
    },
    {
      id: "quick-open",
      label: t("Open file"),
      group: t("File"),
      shortcut: `${mod}+P`,
    },
    {
      id: "save",
      label: t("Save"),
      group: t("File"),
      shortcut: `${mod}+S`,
    },
    {
      id: "save-all",
      label: t("Save all"),
      group: t("File"),
      shortcut: `${mod}+Shift+S`,
    },
    {
      id: "reload",
      label: t("Reload from disk"),
      group: t("File"),
      shortcut: "",
    },
    {
      id: "close",
      label: t("Close editor"),
      group: t("File"),
      shortcut: `${mod}+W`,
    },
    {
      id: "close-others",
      label: t("Close others"),
      group: t("File"),
      shortcut: "",
    },
    {
      id: "close-all",
      label: t("Close all editors"),
      group: t("File"),
      shortcut: "",
    },
    {
      id: "reopen",
      label: t("Reopen closed file"),
      group: t("File"),
      shortcut: `${mod}+Shift+T`,
    },
    {
      id: "undo",
      label: t("Undo"),
      group: t("Edit"),
      shortcut: `${mod}+Z`,
    },
    {
      id: "redo",
      label: t("Redo"),
      group: t("Edit"),
      shortcut: `${mod}+Shift+Z`,
    },
    {
      id: "find",
      label: t("Find in file"),
      group: t("Edit"),
      shortcut: `${mod}+F`,
    },
    {
      id: "replace",
      label: t("Replace in file"),
      group: t("Edit"),
      shortcut: `${mod}+H`,
    },
    {
      id: "search-project",
      label: t("Find in project"),
      group: t("Edit"),
      shortcut: `${mod}+Shift+F`,
    },
    {
      id: "comment",
      label: t("Toggle comment"),
      group: t("Edit"),
      shortcut: `${mod}+/`,
    },
    {
      id: "indent",
      label: t("Increase indent"),
      group: t("Edit"),
      shortcut: "Tab",
    },
    {
      id: "outdent",
      label: t("Decrease indent"),
      group: t("Edit"),
      shortcut: "Shift+Tab",
    },
    {
      id: "select-all",
      label: t("Select all"),
      group: t("Selection"),
      shortcut: `${mod}+A`,
    },
    {
      id: "next-match",
      label: t("Select next match"),
      group: t("Selection"),
      shortcut: `${mod}+D`,
    },
    {
      id: "duplicate-line",
      label: t("Duplicate line"),
      group: t("Selection"),
      shortcut: "Alt+Shift+↓",
    },
    {
      id: "delete-line",
      label: t("Delete line"),
      group: t("Selection"),
      shortcut: `${mod}+Shift+K`,
    },
    {
      id: "move-up",
      label: t("Move line up"),
      group: t("Selection"),
      shortcut: "Alt+↑",
    },
    {
      id: "move-down",
      label: t("Move line down"),
      group: t("Selection"),
      shortcut: "Alt+↓",
    },
    {
      id: "palette",
      label: t("Show all commands"),
      group: t("View"),
      shortcut: `${mod}+Shift+P`,
    },
    {
      id: "toggle-files",
      label: t("Toggle explorer"),
      group: t("View"),
      shortcut: `${mod}+B`,
    },
    {
      id: "toggle-agent",
      label: t("Toggle agent"),
      group: t("View"),
      shortcut: "",
    },
    {
      id: "split",
      label: t("Split editor"),
      group: t("View"),
      shortcut: `${mod}+\\`,
    },
    {
      id: "wrap",
      label: t("Wrap long lines"),
      group: t("View"),
      shortcut: "Alt+Z",
    },
    {
      id: "font-up",
      label: t("Increase editor font size"),
      group: t("View"),
      shortcut: "",
    },
    {
      id: "font-down",
      label: t("Decrease editor font size"),
      group: t("View"),
      shortcut: "",
    },
    {
      id: "font-reset",
      label: t("Reset editor font size"),
      group: t("View"),
      shortcut: "",
    },
    {
      id: "fold-all",
      label: t("Fold all blocks"),
      group: t("View"),
      shortcut: "",
    },
    {
      id: "unfold-all",
      label: t("Unfold all blocks"),
      group: t("View"),
      shortcut: "",
    },
    {
      id: "back",
      label: t("Previous"),
      group: t("Go"),
      shortcut: "Alt+←",
    },
    {
      id: "forward",
      label: t("Forward"),
      group: t("Go"),
      shortcut: "Alt+→",
    },
    {
      id: "go-line",
      label: t("Go to line"),
      group: t("Go"),
      shortcut: `${mod}+G`,
    },
    {
      id: "previous-tab",
      label: t("Previous tab"),
      group: t("Go"),
      shortcut: `${mod}+PgUp`,
    },
    {
      id: "next-tab",
      label: t("Next tab"),
      group: t("Go"),
      shortcut: `${mod}+PgDn`,
    },
    {
      id: "toggle-terminal",
      label: t("Toggle terminal"),
      group: t("Terminal"),
      shortcut: `${mod}+\u0060`,
    },
  ];
}

export function commandShortcut(event: KeyboardEvent): CommandId | null {
  if (event.key === "F1") return "palette";
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.code === "KeyZ") return "wrap";
    if (event.code === "ArrowLeft") return "back";
    if (event.code === "ArrowRight") return "forward";
    return null;
  }
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return null;
  if (event.shiftKey) {
    const shifted: Record<string, CommandId> = {
      KeyP: "palette",
      KeyF: "search-project",
      KeyS: "save-all",
      KeyT: "reopen",
      Tab: "previous-tab",
    };
    return shifted[event.code] ?? null;
  }
  const plain: Record<string, CommandId> = {
    KeyP: "quick-open",
    KeyS: "save",
    KeyW: "close",
    KeyN: "new-file",
    KeyB: "toggle-files",
    KeyG: "go-line",
    Backquote: "toggle-terminal",
    Backslash: "split",
    PageUp: "previous-tab",
    PageDown: "next-tab",
    Tab: "next-tab",
  };
  return plain[event.code] ?? null;
}
