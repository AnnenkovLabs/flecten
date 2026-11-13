// Mechanical checks for the AGENTS.md rules. Every message says how to fix the problem.
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  isCodeFile,
  localImports,
  reachableFrom,
  rel,
  scriptSource,
  sourceFile,
  walk,
} from "./graph.mjs";

export const MAX_LINES = 500;
// Product entry points plus the documented diagnostics CLI (docs/PRIVACY.md).
const ENTRIES = [
  "src/app/server.ts",
  "src/connectors/x/server.ts",
  "ui/src/main.ts",
  "shell/main.mjs",
  "shell/preload.cjs",
  "scripts/diagnostics.mjs",
];
const PRODUCT_DIRS = ["src", "ui/src"];
/** Module package content is loaded by the module runtime, not imported by the harness. */
const CONTENT_PREFIXES = ["src/marketplace/modules/"];
const isContent = (file) => CONTENT_PREFIXES.some((prefix) => rel(file).startsWith(prefix));
const SIZE_DIRS = ["src", "ui/src", "shell", "scripts", "tests"];
const TEXT_DIRS = ["docs", "prompts", "ui/src", "src", "shell"];
const TEXT_FILES = ["README.md", "AGENTS.md", "CHANGELOG.md", "design.md", "CONTRIBUTING.md"];
const EM_DASH = String.fromCharCode(0x2014);
/** Files stored word for word on purpose (AGENTS.md: raw user messages are kept verbatim). */
const EM_DASH_EXEMPT = new Set(["docs/SOURCE-MESSAGES.md", "docs/research/memory-v2-traces.jsonl"]);

function lineCount(text) {
  if (text.length === 0) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function isGenerated(file) {
  return file.endsWith(".generated.ts");
}

function deadCode() {
  const reachable = reachableFrom(ENTRIES);
  const out = new Map();
  for (const dir of PRODUCT_DIRS) {
    for (const file of walk(dir, isCodeFile))
      if (!reachable.has(file) && !isContent(file)) out.set(rel(file), 1);
  }
  return out;
}

function fileSize() {
  const out = new Map();
  const accept = (file) => isCodeFile(file) || file.endsWith(".css");
  for (const dir of SIZE_DIRS) {
    for (const file of walk(dir, accept)) {
      if (isGenerated(file) || isContent(file)) continue;
      const lines = lineCount(readFileSync(file, "utf8"));
      if (lines > MAX_LINES) out.set(rel(file), lines);
    }
  }
  return out;
}

const FORBIDDEN_IMPORTS = [
  {
    from: "src/core/",
    to: ["src/store/", "ui/", "shell/"],
    rule: "core does not import store, ui or shell",
  },
  {
    from: "ui/src/",
    to: ["src/"],
    rule: "ui talks to the sidecar through the bridge, it does not import src",
  },
  {
    from: "shell/",
    to: ["src/", "ui/src/"],
    rule: "shell has no harness logic and does not import src or ui sources",
  },
];

function boundaries() {
  const out = new Map();
  for (const dir of ["src/core", "ui/src", "shell"]) {
    for (const file of walk(dir, isCodeFile)) {
      const from = rel(file);
      for (const { target } of localImports(file)) {
        const to = rel(target);
        for (const boundary of FORBIDDEN_IMPORTS) {
          if (!from.startsWith(boundary.from)) continue;
          if (boundary.to.some((prefix) => to.startsWith(prefix))) out.set(`${from} -> ${to}`, 1);
        }
      }
    }
  }
  return out;
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function consoleUse() {
  const out = new Map();
  for (const file of walk("src", isCodeFile)) {
    if (rel(file) === "src/app/server.ts" || isContent(file)) continue;
    let count = 0;
    visit(sourceFile(file), (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "console"
      ) {
        count += 1;
      }
    });
    if (count > 0) out.set(rel(file), count);
  }
  return out;
}

function regexUse() {
  const out = new Map();
  for (const dir of PRODUCT_DIRS) {
    for (const file of walk(dir, isCodeFile)) {
      if (isContent(file)) continue;
      let count = 0;
      visit(sourceFile(file), (node) => {
        if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) count += 1;
        if (
          (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "RegExp"
        ) {
          count += 1;
        }
      });
      if (count > 0) out.set(rel(file), count);
    }
  }
  return out;
}

function emDash() {
  const out = new Map();
  const files = [
    ...TEXT_FILES.map((name) => `${process.cwd()}/${name}`),
    ...TEXT_DIRS.flatMap((dir) => walk(dir, () => true)),
  ];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const count = text.split(EM_DASH).length - 1;
    if (count > 0 && !EM_DASH_EXEMPT.has(rel(file))) out.set(rel(file), count);
  }
  return out;
}

export const RULES = [
  {
    id: "dead-code",
    title: "Module is not reachable from src/app/server.ts, ui/src/main.ts or shell/main.mjs",
    fix: "Wire the module into the real product path and test that path, or delete it with its test (AGENTS.md: dead code is forbidden).",
    collect: deadCode,
  },
  {
    id: "file-size",
    title: `File is longer than ${MAX_LINES} lines`,
    fix: "Split the file by responsibility: one file does one thing, soft limit 300 lines, hard limit 500.",
    collect: fileSize,
  },
  {
    id: "boundaries",
    title: "Import crosses a layer boundary",
    fix: "core does not import store/ui/shell; ui does not import src; shell has no harness logic. Move the shared type or send a typed event instead.",
    collect: boundaries,
  },
  {
    id: "console",
    title: "Core code writes to console",
    fix: "Emit a typed event through the bus or return the error to the caller; only src/app/server.ts writes to the process streams.",
    collect: consoleUse,
  },
  {
    id: "regex",
    title: "Regular expression in product code",
    fix: "Behavior must come from state, schemas, typed events or an explicit API. A regex is allowed only to validate a format at a boundary: then add the file with a reason to scripts/rules/regex-allowlist.json.",
    collect: regexUse,
  },
  {
    id: "em-dash",
    title: "Long dash (U+2014) in docs or interface text",
    fix: "Use a period, colon, comma or a short hyphen instead of the long dash.",
    collect: emDash,
  },
];

export { scriptSource };
