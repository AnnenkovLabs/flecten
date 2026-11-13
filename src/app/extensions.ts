import { acceptsImages } from "../../shared/vision";
import type { HarnessConfig } from "../config/schema";
import type { PromptSection } from "../core/prompt";
import { renderMcpInstructions } from "../mcp/prompt";
import { connectMcpServers, type McpRuntime, type McpSessionOptions } from "../mcp/session";
import { renderSkillCatalog } from "../skills/catalog";
import { discoverSkills, type SkillDiscovery } from "../skills/discover";
import { skillToolPolicy } from "../skills/policy";
import { createSkillTool, type SkillActivations } from "../skills/tool";
import { builtinTools } from "../tools/builtin";
import { ToolRegistry } from "../tools/registry";
import type { Tool } from "../tools/types";
import { inputModalities } from "./service-policy";

export interface AppExtensions {
  tools: Tool[];
  /** Optional prompt sections; the prompt budget trims them before anything required. */
  sections: PromptSection[];
  skills: SkillDiscovery;
  skillActivations?: SkillActivations;
  mcp: McpRuntime;
  dispose(): Promise<void>;
}

export async function createExtensions(
  cwd: string,
  config: HarnessConfig,
  options: McpSessionOptions = {},
  skillActivations: SkillActivations = new Map(),
): Promise<AppExtensions> {
  const [skills, mcp] = await Promise.all([
    discoverSkills(cwd, {
      sources: config.skills?.sources,
      ...(config.skills?.trust ? { trust: config.skills.trust } : {}),
    }),
    connectMcpServers(config.mcp.servers, cwd, options),
  ]);
  return withSkills(
    { tools: [], sections: [], skills, mcp, skillActivations, dispose: () => mcp.close() },
    skills,
  );
}

/** Rebuild only the skill catalog and tool, keeping live MCP connections intact. */
export function withSkills(
  extensions: AppExtensions,
  skills: SkillDiscovery,
  active = true,
): AppExtensions {
  const activations = extensions.skillActivations ?? new Map();
  const skillTool = active ? createSkillTool(skills.skills, activations) : undefined;
  return {
    ...extensions,
    skillActivations: activations,
    tools: [...(skillTool ? [skillTool] : []), ...extensions.mcp.tools],
    sections: promptSections({
      skills: active ? renderSkillCatalog(skills.skills) : undefined,
      mcp: renderMcpInstructions(extensions.mcp.instructions),
    }),
    skills,
  };
}

function promptSections(texts: Record<string, string | undefined>): PromptSection[] {
  return Object.entries(texts).flatMap(([id, text]) => (text === undefined ? [] : [{ id, text }]));
}

export function deferredExtensions(discovery: SkillDiscovery): AppExtensions {
  const mcp: McpRuntime = {
    tools: [],
    statuses: [],
    instructions: [],
    close: async () => undefined,
  };
  return { tools: [], sections: [], skills: discovery, mcp, dispose: async () => undefined };
}

export function registryFor(
  extensions: () => AppExtensions,
  config: HarnessConfig,
  moduleTool?: Tool,
): ToolRegistry {
  return new ToolRegistry(
    [
      ...builtinTools(!acceptsImages(inputModalities(config))),
      ...extensions().tools,
      ...(moduleTool ? [moduleTool] : []),
    ],
    {
      limits: config.tools,
      authorize: skillToolPolicy(extensions().skillActivations, () => extensions().skills),
    },
  );
}
