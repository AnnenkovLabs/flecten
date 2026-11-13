import { z } from "zod";

export const MAX_SKILL_BYTES = 256 * 1024;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine((name) => !hasControlCharacter(name), "name cannot contain control characters"),
  description: z.string().trim().min(1).max(4096),
  license: z.string().trim().min(1).optional(),
  compatibility: z.string().trim().min(1).max(500).optional(),
  version: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(z.string().min(1).max(64))
    .optional(),
  "argument-hint": z.string().trim().min(1).max(256).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().trim().min(1).optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export type SkillSource = "user" | "project";
export type SkillTrust = "trusted" | "untrusted";

export interface Skill {
  name: string;
  description: string;
  location: string;
  directory: string;
  source: SkillSource;
  trust: SkillTrust;
  version?: string;
  argumentHint?: string;
  compatibility?: string;
  allowedTools?: string[];
}

export interface ParseSkillOptions {
  source?: SkillSource;
  trust?: SkillTrust;
}

export function parseAllowedTools(value: string | undefined): string[] | undefined {
  const tools = (value ?? "")
    .split(/[\s,]+/)
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  if (tools.length === 0) return undefined;
  return [...new Set(tools)];
}

export interface SkillDiagnostic {
  level: "warning" | "error";
  source: string;
  message: string;
}

export interface ParsedSkill {
  skill?: Skill;
  body?: string;
  diagnostics: SkillDiagnostic[];
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function diagnostic(
  level: SkillDiagnostic["level"],
  source: string,
  message: string,
): SkillDiagnostic {
  return { level, source, message };
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return String(JSON.parse(trimmed));
    } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function lenientFrontmatter(source: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(lines[index] ?? "");
    if (!match?.[1]) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if (value === "|" || value === ">") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1] ?? "")) {
        index += 1;
        block.push((lines[index] ?? "").trim());
      }
      value = block.join(value === "|" ? "\n" : " ");
    }
    if (value.length > 0) fields[key] = scalar(value);
  }
  return fields;
}

export function parseSkillFile(
  text: string,
  location: string,
  directory: string,
  options: ParseSkillOptions = {},
): ParsedSkill {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) {
    return {
      diagnostics: [
        diagnostic("error", location, "SKILL.md needs YAML frontmatter between --- lines"),
      ],
    };
  }

  const diagnostics: SkillDiagnostic[] = [];
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(match[1] ?? "");
  } catch (error) {
    raw = lenientFrontmatter(match[1] ?? "");
    const strict = SkillFrontmatterSchema.safeParse(raw);
    if (!strict.success) {
      return {
        diagnostics: [
          diagnostic(
            "error",
            location,
            `cannot parse SKILL.md frontmatter: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      };
    }
    diagnostics.push(
      diagnostic(
        "warning",
        location,
        `YAML is invalid; loaded scalar fields with the lenient fallback: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  const parsed = SkillFrontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      diagnostics: parsed.error.issues.map((issue) =>
        diagnostic(
          "error",
          location,
          `frontmatter ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      ),
    };
  }

  const directoryName = directory.split(/[\\/]/).at(-1) ?? "";
  if (!NAME_PATTERN.test(parsed.data.name)) {
    diagnostics.push(
      diagnostic(
        "warning",
        location,
        `name "${parsed.data.name}" violates the Agent Skills name format; loading it anyway`,
      ),
    );
  }
  if (parsed.data.name.length > 64) {
    diagnostics.push(
      diagnostic("warning", location, "name exceeds the 64 character specification limit"),
    );
  }
  if (parsed.data.description.length > 1024) {
    diagnostics.push(
      diagnostic("warning", location, "description exceeds the 1024 character specification limit"),
    );
  }
  if (parsed.data.name !== directoryName) {
    diagnostics.push(
      diagnostic(
        "warning",
        location,
        `name "${parsed.data.name}" does not match directory "${directoryName}"; loading it anyway`,
      ),
    );
  }

  const version = parsed.data.version ?? parsed.data.metadata?.version;
  const allowedTools = parseAllowedTools(parsed.data["allowed-tools"]);
  return {
    skill: {
      name: parsed.data.name,
      description: parsed.data.description,
      location,
      directory,
      source: options.source ?? "project",
      trust: options.trust ?? "trusted",
      ...(version ? { version } : {}),
      ...(parsed.data["argument-hint"] ? { argumentHint: parsed.data["argument-hint"] } : {}),
      ...(parsed.data.compatibility ? { compatibility: parsed.data.compatibility } : {}),
      ...(allowedTools ? { allowedTools } : {}),
    },
    body: (match[2] ?? "").trim(),
    diagnostics,
  };
}
