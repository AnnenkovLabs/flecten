import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import AiBrain01Icon from "@hugeicons/core-free-icons/AiBrain01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowDown02Icon from "@hugeicons/core-free-icons/ArrowDown02Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import Asterisk02Icon from "@hugeicons/core-free-icons/Asterisk02Icon";
import Attachment01Icon from "@hugeicons/core-free-icons/Attachment01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Delete01Icon from "@hugeicons/core-free-icons/Delete01Icon";
import Edit01Icon from "@hugeicons/core-free-icons/Edit01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon";
import SidebarRight01Icon from "@hugeicons/core-free-icons/SidebarRight01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import StopIcon from "@hugeicons/core-free-icons/StopIcon";
import Task01Icon from "@hugeicons/core-free-icons/Task01Icon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import type { IconSvgElement } from "@hugeicons/svelte";

const ParenIcon = [
  [
    "path",
    {
      d: "M14 3Q6 12 14 21",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: "1.5",
      key: "0",
    },
  ],
] satisfies IconSvgElement;

export const ICONS = {
  mark: Asterisk02Icon,
  "panel-left": SidebarLeft01Icon,
  "panel-right": SidebarRight01Icon,
  plus: Add01Icon,
  search: Search01Icon,
  tasks: Task01Icon,
  brain: AiBrain01Icon,
  image: Image01Icon,
  settings: Settings01Icon,
  folder: Folder01Icon,
  "folder-plus": FolderAddIcon,
  "chevron-down": ArrowDown01Icon,
  "chevron-right": ArrowRight01Icon,
  paren: ParenIcon,
  more: MoreHorizontalIcon,
  check: CheckIcon,
  copy: Copy01Icon,
  refresh: Refresh01Icon,
  terminal: TerminalIcon,
  "arrow-up": ArrowUp02Icon,
  "arrow-down": ArrowDown02Icon,
  stop: StopIcon,
  spark: SparklesIcon,
  file: File01Icon,
  edit: Edit01Icon,
  x: Cancel01Icon,
  branch: GitBranchIcon,
  trash: Delete01Icon,
  server: ServerStack01Icon,
  key: Key01Icon,
  mic: Mic01Icon,
  star: StarIcon,
  attachment: Attachment01Icon,
  layers: Layers01Icon,
} satisfies Record<string, IconSvgElement>;

/** Icon names come from the map itself, so a new icon needs exactly one line. */
export type IconName = keyof typeof ICONS;
