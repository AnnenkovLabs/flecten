#!/usr/bin/env bun
// Mechanical AGENTS.md rules: dead code, file size, layer boundaries, console, regex, long dash.
//   bun scripts/check-rules.mjs                  fail on any violation that is not in the baseline
//   bun scripts/check-rules.mjs --shrink-baseline drop fixed entries from the baseline (never adds)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBaseline, writeBaseline } from "./rules/baseline.mjs";
import { root } from "./rules/graph.mjs";
import { RULES } from "./rules/rules.mjs";

const args = new Set(process.argv.slice(2));
const shrink = args.has("--shrink-baseline");
const init = args.has("--init-baseline");
const allowlistFile = join(root, "scripts/rules/regex-allowlist.json");
const regexAllowlist = existsSync(allowlistFile)
  ? JSON.parse(readFileSync(allowlistFile, "utf8"))
  : {};

const baseline = readBaseline();
const nextBaseline = {};
const problems = [];
let debt = 0;

for (const rule of RULES) {
  const found = rule.collect();
  if (rule.id === "regex") {
    for (const file of Object.keys(regexAllowlist)) {
      if (!found.has(file)) {
        problems.push(
          `[regex] allowlist entry ${file} has no regular expression now. Remove it from scripts/rules/regex-allowlist.json`,
        );
      }
      found.delete(file);
    }
  }
  const known = baseline[rule.id] ?? {};
  const kept = {};
  for (const [key, value] of found) {
    const allowed = known[key];
    if (init) {
      kept[key] = value;
      continue;
    }
    if (allowed === undefined) {
      problems.push(
        `[${rule.id}] ${key}${value > 1 ? ` (${value})` : ""}: ${rule.title}.\n  Fix: ${rule.fix}`,
      );
      continue;
    }
    if (value > allowed) {
      problems.push(
        `[${rule.id}] ${key} grew from ${allowed} to ${value}: ${rule.title}.\n  Fix: ${rule.fix}`,
      );
    }
    kept[key] = Math.min(value, allowed);
    debt += 1;
  }
  const stale = Object.keys(known).filter((key) => !found.has(key) || found.get(key) < known[key]);
  if (stale.length > 0 && !shrink && !init) {
    for (const key of stale) {
      problems.push(
        `[${rule.id}] baseline entry ${key} is fixed or smaller now. Run: bun scripts/check-rules.mjs --shrink-baseline`,
      );
    }
  }
  if (Object.keys(kept).length > 0) nextBaseline[rule.id] = kept;
}

if (shrink || init) {
  writeBaseline(nextBaseline);
  console.log(`rules: baseline written with ${debt} known violations`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`rules: ${problems.length} problem(s). Known debt in baseline: ${debt}.`);
  process.exit(1);
}
console.log(`rules: pass (${RULES.length} rules, known debt in baseline: ${debt})`);
