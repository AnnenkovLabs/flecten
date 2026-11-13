#!/usr/bin/env bun
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseJsonBlocks,
  parseProtocolCommands,
  parseTableNames,
  parseToolNames,
} from "./docs/markdown.mjs";
import { extractStringUnion, extractUnionMembers, objectLiteralStrings } from "./docs/source.mjs";

const REPO = new URL("../", import.meta.url);
const PROTOCOL_DOC = "docs/PROTOCOL.md";
const TOOLS_DOC = "docs/TOOLS.md";
const CONFIG_DOC = "docs/EXTENSIONS.md";
const SECURITY_DOC = "docs/SECURITY.md";
/** Envelope fields any command may carry on the wire; the Command type does not list them. */
const TRANSPORT_FIELDS = new Set(["sessionId", "requestId"]);

export function compareDocumented(kind, documented, actual, docPath, sourcePath) {
  const known = new Set(actual);
  return documented
    .filter((name) => !known.has(name))
    .map((name) => `${docPath}: documented ${kind} "${name}" is not exported by ${sourcePath}`);
}

/** Names the code has but the document does not: the other half of compareDocumented. */
export function compareMissing(kind, documented, actual, docPath, sourcePath) {
  const known = new Set(documented);
  return actual
    .filter((name) => !known.has(name))
    .map((name) => `${docPath}: ${kind} "${name}" from ${sourcePath} is not documented`);
}

export function checkConfigValue(value, schema, where = "config") {
  const issues = [];
  walkConfig(value, schema, "$", where, issues);
  return issues;
}

function walkConfig(value, schema, field, where, issues) {
  if (schema === undefined || schema === null) return;
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((branch) => {
      const branchIssues = [];
      walkConfig(value, branch, field, where, branchIssues);
      return branchIssues;
    });
    if (branches.every((branchIssues) => branchIssues.length > 0)) {
      issues.push(`${where}: config field "${field}" does not match any allowed shape`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, index) => {
        walkConfig(item, schema.items, `${field}[${index}]`, where, issues);
      });
    }
    return;
  }
  if (value === null || typeof value !== "object") return;

  const properties = schema.properties ?? {};
  for (const [key, child] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (Object.hasOwn(properties, key)) {
      walkConfig(child, properties[key], childField, where, issues);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      walkConfig(child, schema.additionalProperties, childField, where, issues);
    } else if (schema.additionalProperties !== true) {
      issues.push(`${where}: unknown config field "${childField}"`);
    }
  }
}

/**
 * What the code really sends besides commands, as [kind, PROTOCOL.md section, names, source]:
 * core events, lines the sidecar and the shell write themselves, and error codes.
 */
async function protocolSurface(ts) {
  const read = (path) => readFile(new URL(path, REPO), "utf8");
  const [eventSource, errorSource, serverSource, shellSource, childSource] = await Promise.all([
    read("src/core/types/event.ts"),
    read("src/errors/index.ts"),
    read("src/app/server.ts"),
    read("shell/main.mjs"),
    read("shared/subagents.ts"),
  ]);
  const events = [
    ...extractUnionMembers(ts, eventSource, "Event", "src/core/types/event.ts", [
      { source: childSource, fileName: "shared/subagents.ts" },
    ]).keys(),
  ];
  const isEvent = new Set(events);
  const server = (key) => objectLiteralStrings(ts, serverSource, "src/app/server.ts", key);
  const shell = (key) =>
    objectLiteralStrings(ts, shellSource, "shell/main.mjs", key, "sendToRenderer");
  const messages = [...new Set([...server("type"), ...shell("type")])].filter(
    (type) => !isEvent.has(type),
  );
  const codes = [
    ...new Set([
      ...extractStringUnion(ts, errorSource, "ErrorCode", "src/errors/index.ts"),
      ...server("code"),
      ...shell("code"),
    ]),
  ];
  return [
    ["event", "События", events, "the Event type"],
    ["service message", "Служебные сообщения", messages, "src/app/server.ts or shell/main.mjs"],
    ["error code", "Ошибки", codes, "ErrorCode, src/app/server.ts or shell/main.mjs"],
  ];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function run() {
  const [protocolDoc, toolsDoc, configDoc] = await Promise.all([
    readFile(new URL(PROTOCOL_DOC, REPO), "utf8"),
    readFile(new URL(TOOLS_DOC, REPO), "utf8"),
    readFile(new URL(CONFIG_DOC, REPO), "utf8"),
  ]);
  const file = (path) => new URL(path, REPO).href;
  const [
    tsModule,
    { z },
    { builtinTools },
    configModule,
    mcpConfigModule,
    mcpToolsModule,
    sandboxModule,
    redactModule,
  ] = await Promise.all([
    import("typescript"),
    import("zod"),
    import(file("src/tools/builtin.ts")),
    import(file("src/config/schema.ts")),
    import(file("src/mcp/config.ts")),
    import(file("src/mcp/tools.ts")),
    import(file("src/security/sandbox.ts")),
    import(file("src/util/redact.ts")),
  ]);
  const ts = tsModule.default;

  const issues = [];
  const commandSource = await readFile(new URL("src/core/types/command.ts", REPO), "utf8");
  // The shell allowlist is the full protocol; the core union types the session commands.
  const shellCommands = JSON.parse(
    await readFile(new URL("shell/agent-commands.json", REPO), "utf8"),
  );
  const coreCommands = extractUnionMembers(
    ts,
    commandSource,
    "Command",
    "src/core/types/command.ts",
  );
  for (const name of coreCommands.keys()) {
    if (!shellCommands.includes(name)) {
      issues.push(`shell/agent-commands.json: core command "${name}" is missing`);
    }
  }
  const commandNames = [...new Set([...coreCommands.keys(), ...shellCommands])];
  const documentedCommands = parseProtocolCommands(protocolDoc);
  issues.push(
    ...compareDocumented(
      "command",
      documentedCommands,
      commandNames,
      PROTOCOL_DOC,
      "src/core/types/command.ts or shell/agent-commands.json",
    ),
    ...compareMissing(
      "command",
      documentedCommands,
      shellCommands,
      PROTOCOL_DOC,
      "shell/agent-commands.json",
    ),
  );
  const protocolCounts = [`commands ${documentedCommands.length}`];
  for (const [kind, heading, actual, sourcePath] of await protocolSurface(ts)) {
    const documented = parseTableNames(protocolDoc, heading);
    issues.push(
      ...compareDocumented(kind, documented, actual, PROTOCOL_DOC, sourcePath),
      ...compareMissing(kind, documented, actual, PROTOCOL_DOC, sourcePath),
    );
    protocolCounts.push(`${kind}s ${documented.length}`);
  }

  for (const block of parseJsonBlocks(protocolDoc)) {
    if (block.error) {
      issues.push(`${PROTOCOL_DOC}:${block.line}: invalid JSON example (${block.error})`);
      continue;
    }
    if (!isObject(block.value) || typeof block.value.type !== "string") continue;
    const allowed = coreCommands.get(block.value.type);
    if (allowed === undefined) continue;
    for (const field of Object.keys(block.value)) {
      if (!allowed.has(field) && !TRANSPORT_FIELDS.has(field)) {
        issues.push(
          `${PROTOCOL_DOC}:${block.line}: command "${block.value.type}" field "${field}" is not in the Command type`,
        );
      }
    }
  }

  const tools = builtinTools();
  const toolNames = [...tools.map((tool) => tool.name), "skill", "module"];
  const documentedTools = parseToolNames(toolsDoc);
  issues.push(
    ...compareDocumented("tool", documentedTools, toolNames, TOOLS_DOC, "builtinTools()"),
  );

  const configSchema = z.toJSONSchema(configModule.HarnessConfigSchema, { io: "input" });
  const configBlocks = parseJsonBlocks(configDoc);
  for (const block of configBlocks) {
    if (block.error) {
      issues.push(`${CONFIG_DOC}:${block.line}: invalid JSON example (${block.error})`);
      continue;
    }
    issues.push(...checkConfigValue(block.value, configSchema, `${CONFIG_DOC}:${block.line}`));
  }

  const securityChecks = [];
  const expect = (label, ok, message) => {
    securityChecks.push(label);
    if (!ok) issues.push(message);
  };

  expect(
    "redact",
    !redactModule.redact("key sk-abcdefghijk").includes("sk-abcdefghijk"),
    `${SECURITY_DOC}: redact must remove API keys before they reach logs`,
  );

  const sandboxDefaults = configModule.SandboxConfigSchema.parse({});
  expect(
    "sandbox defaults",
    sandboxDefaults.enabled === true && sandboxDefaults.allowNetwork === false,
    `${SECURITY_DOC}: sandbox must be enabled and deny network by default`,
  );

  const permissions = configModule.PermissionsConfigSchema.parse({});
  expect(
    "permission defaults",
    permissions.network === "ask" &&
      permissions.mcp === "ask" &&
      permissions.externalPath === "deny",
    `${SECURITY_DOC}: default permissions must ask for network and MCP and deny external paths`,
  );

  const protectedWrites = new Set(sandboxModule.DEFAULT_PROTECTED_WRITE_PREFIXES);
  for (const path of [
    ".git",
    ".liquid",
    "flecten.config.json",
    "AGENTS.md",
    "secrets.json",
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    "~/.ssh",
    "~/.aws",
  ]) {
    expect(
      `protected ${path}`,
      protectedWrites.has(path),
      `${SECURITY_DOC}: protected write path "${path}" is missing from DEFAULT_PROTECTED_WRITE_PREFIXES`,
    );
  }

  const writeTool = tools.find((tool) => tool.name === "write");
  expect(
    "write.why",
    writeTool?.parameters?.properties?.why !== undefined,
    `${SECURITY_DOC}: write must accept "why" for paths outside the project`,
  );

  const root = await mkdtemp(join(tmpdir(), "liquid-docs-check-"));
  try {
    const decision = await new sandboxModule.SandboxPolicy({ workspaceRoot: root }).checkWrite(
      "../outside.txt",
    );
    expect(
      "sandbox outside write",
      decision.allowed === false,
      `${SECURITY_DOC}: sandbox must deny writes outside the workspace`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const hook = configModule.HookCommandSchema.parse({ command: "true" });
  expect(
    "hook timeout",
    hook.timeoutMs === 10_000 &&
      !configModule.HookCommandSchema.safeParse({ command: "true", timeoutMs: 60_001 }).success,
    `${SECURITY_DOC}: hook timeout must default to 10 seconds and never exceed 60 seconds`,
  );

  const emptyHooks = configModule.HooksConfigSchema.parse({});
  expect(
    "hooks explicit",
    Object.values(emptyHooks).every((list) => list.length === 0),
    `${SECURITY_DOC}: hooks must run only when explicitly configured`,
  );
  const emptyMcp = configModule.McpConfigSchema.parse({});
  expect(
    "mcp explicit",
    Object.keys(emptyMcp.servers).length === 0,
    `${SECURITY_DOC}: MCP servers must run only when explicitly configured`,
  );

  const mcpConfig = mcpConfigModule.McpStdioServerConfigSchema.parse({ command: "true" });
  expect(
    "mcp limits",
    mcpConfig.timeoutMs === 60_000 &&
      mcpConfig.maxTools === 64 &&
      !mcpConfigModule.McpStdioServerConfigSchema.safeParse({
        command: "true",
        maxTools: 129,
      }).success,
    `${SECURITY_DOC}: MCP timeout and tool limits must match the documented caps`,
  );

  const mcpTool = mcpToolsModule.createMcpTool(
    "docs",
    mcpConfig,
    { callTool: async () => ({ content: [] }) },
    { name: "echo", inputSchema: { type: "object", properties: {} } },
    "mcp_docs_echo",
  );
  expect(
    "mcp mutating",
    mcpTool?.mutating === true,
    `${SECURITY_DOC}: every MCP tool must stay mutating until approvals exist`,
  );
  expect(
    "mcp timeout",
    mcpTool?.timeoutMs?.({}) === mcpConfig.timeoutMs,
    `${SECURITY_DOC}: every MCP tool must carry the server timeout`,
  );

  const counts = [
    `protocol: ${protocolCounts.join(", ")}`,
    `tools ${documentedTools.length}`,
    `config ${configBlocks.length}`,
    `security ${securityChecks.length}`,
  ].join(", ");
  if (issues.length === 0) {
    console.log(`docs-check: pass (${counts})`);
    return 0;
  }
  console.error(`docs-check: ${issues.length} mismatch(es) (${counts})`);
  for (const issue of issues) console.error(`  ${issue}`);
  return 1;
}

if (import.meta.main) {
  run()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(
        `docs-check: ${error instanceof Error ? (error.stack ?? error.message) : error}`,
      );
      process.exit(1);
    });
}
