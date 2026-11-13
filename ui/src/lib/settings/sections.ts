import { t } from "../i18n.svelte";
import type { IconName } from "../icons";

export type SettingsSectionId =
  | "general"
  | "providers"
  | "permissions"
  | "sandbox"
  | "tools"
  | "history"
  | "dictionary"
  | "mcp"
  | "hooks"
  | "skills"
  | "about"
  | "modules";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: IconName;
  fields: string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "general",
    get label() {
      return t("General");
    },
    icon: "settings",
    get fields() {
      return [
        t("Sending"),
        "sendShortcut",
        t("Messages while working"),
        "followUpBehavior",
        t("Task recovery"),
        "autoResume",
        t("Concurrent tasks"),
        "maxConcurrent",
        t("Interface language"),
        t("English 简体中文 Português Español 日本語 Українська Русский"),
      ];
    },
  },
  {
    id: "providers",
    get label() {
      return t("Providers");
    },
    icon: "server",
    get fields() {
      return [t("Provider"), t("Model"), "Base URL", t("Key"), t("Protocol")];
    },
  },
  {
    id: "permissions",
    get label() {
      return t("Permissions");
    },
    icon: "key",
    get fields() {
      return [t("Rules"), t("Policies"), t("Approvals"), t("Allow all"), t("Deny all")];
    },
  },
  {
    id: "sandbox",
    get label() {
      return t("Sandbox");
    },
    icon: "layers",
    get fields() {
      return [
        t("Sandbox"),
        t("Network"),
        t("Blocked read paths"),
        t("Blocked write paths"),
        t("Environment variables"),
      ];
    },
  },
  {
    id: "tools",
    get label() {
      return t("Terminal and tools");
    },
    icon: "terminal",
    get fields() {
      return [
        "Shell",
        "scrollback",
        "commandTimeoutMs",
        t("Background commands"),
        "notifyOnExit",
        t("Output limit in bytes"),
        "maxOutputBytes",
        t("Output line limit"),
        "maxOutputLines",
        t("bash timeout"),
        "bashTimeoutMs",
        t("Read limit"),
        "readLimitLines",
      ];
    },
  },
  {
    id: "history",
    get label() {
      return t("History and rollback");
    },
    icon: "refresh",
    get fields() {
      return [
        t("File snapshots"),
        t("Command snapshots"),
        "checkpoints",
        t("Snapshot retention"),
        "maxAgeDays",
        t("Snapshot count"),
        "keep",
      ];
    },
  },
  {
    id: "dictionary",
    get label() {
      return t("Memory and dictionary");
    },
    icon: "brain",
    get fields() {
      return [
        t("Public dictionary"),
        t("Local dictionary"),
        t("Term"),
        t("Definition"),
        t("Other spellings, one per line"),
      ];
    },
  },
  {
    id: "mcp",
    label: "MCP",
    icon: "attachment",
    get fields() {
      return [
        t("Servers"),
        t("Command"),
        t("Arguments"),
        t("Timeout"),
        t("Tool limit"),
        t("Protocol"),
      ];
    },
  },
  {
    id: "hooks",
    get label() {
      return t("Hooks");
    },
    icon: "branch",
    get fields() {
      return [t("Events"), t("Command"), "Matcher", t("Timeout"), t("Block on failure")];
    },
  },
  {
    id: "skills",
    get label() {
      return t("Skills");
    },
    icon: "spark",
    get fields() {
      return [
        t("Skills"),
        t("Sources"),
        t("Shared folders"),
        t("Project folders"),
        "Claude",
        "agents",
        "Flecten",
        t("Diagnostics"),
      ];
    },
  },
  {
    id: "modules",
    get label() {
      return t("Modules");
    },
    icon: "layers",
    get fields() {
      return [
        t("Modules"),
        t("Marketplace"),
        t("Catalog sources"),
        t("Installation"),
        t("Trust"),
        t("Version"),
      ];
    },
  },
  {
    id: "about",
    get label() {
      return t("About");
    },
    icon: "mark",
    get fields() {
      return [t("Version"), t("Directory"), t("Secrets"), t("Diagnostics"), t("Report")];
    },
  },
];

export type SettingsSearchMatch = SettingsSectionDefinition;

export function searchSettingsSections(query: string): SettingsSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return SETTINGS_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      icon: section.icon,
      fields: [],
    }));
  }
  const matches: SettingsSearchMatch[] = [];
  for (const section of SETTINGS_SECTIONS) {
    const fields = section.fields.filter((field) => field.toLowerCase().includes(needle));
    if (section.label.toLowerCase().includes(needle) || fields.length > 0) {
      matches.push({ id: section.id, label: section.label, icon: section.icon, fields });
    }
  }
  return matches;
}
