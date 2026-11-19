import {
  type CodeSymbol,
  detectLineSymbol,
  splitIdentifier,
  tokenizeIdentifierTerms,
} from "../util/code-symbols";

export { detectLineSymbol };

export interface GrepRenderLine {
  readonly path: string;
  readonly line: number;
  readonly matched: boolean;
  readonly text: string;
}

export interface GrepBlock {
  readonly path: string;
  readonly firstLine: number;
  readonly matchCount: number;
  readonly lines: GrepRenderLine[];
}

export const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "if",
  "in",
  "is",
  "it",
  "not",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

function filePathPenalty(filePath: string): number {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const base = segments.at(-1) ?? "";
  let penalty = 1.0;

  const isTestDir = segments.some(
    (seg) =>
      seg === "test" ||
      seg === "tests" ||
      seg === "__tests__" ||
      seg === "spec" ||
      seg === "testing" ||
      seg === "fixtures",
  );
  const isTestFile =
    base.includes(".test.") ||
    base.includes(".spec.") ||
    base.startsWith("test_") ||
    base.includes("_test.") ||
    base.includes("_spec.");

  if (isTestDir || isTestFile) {
    penalty *= 0.3;
  }
  if (
    segments.some(
      (seg) =>
        seg === "compat" ||
        seg === "_compat" ||
        seg === "legacy" ||
        seg === "examples" ||
        seg === "example" ||
        seg === "docs" ||
        seg === "doc",
    ) ||
    base.endsWith(".md") ||
    base.endsWith(".txt")
  ) {
    penalty *= 0.3;
  }
  if (base === "__init__.py" || base === "package-info.java" || base === "index.ts") {
    penalty *= 0.7;
  }
  if (base.endsWith(".d.ts")) {
    penalty *= 0.7;
  }
  return penalty;
}

export function nodeKindBoost(kind: CodeSymbol["kind"]): number {
  switch (kind) {
    case "function":
    case "method":
      return 2.0;
    case "class":
    case "interface":
      return 1.8;
    case "type":
      return 1.6;
    case "const":
      return 1.3;
  }
}

export function fileStemTokens(filePath: string): Set<string> {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const file = segments.at(-1) ?? "";
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const parent = segments.length >= 2 ? (segments.at(-2) ?? "") : "";
  const out = new Set<string>();
  for (const tok of splitIdentifier(stem)) out.add(tok);
  if (parent && parent !== "." && parent !== "..") {
    for (const tok of splitIdentifier(parent)) out.add(tok);
  }
  return out;
}

function stemMatchRatio(queryTerms: readonly string[], stemParts: ReadonlySet<string>): number {
  const keywords = queryTerms.filter((term) => term.length > 2 && !STOPWORDS.has(term));
  if (keywords.length === 0) return 0;
  let matched = 0;
  for (const kw of keywords) {
    if (stemParts.has(kw)) {
      matched += 1;
      continue;
    }
    for (const part of stemParts) {
      const shorter = kw.length <= part.length ? kw : part;
      const longer = kw.length <= part.length ? part : kw;
      if (shorter.length >= 3 && longer.startsWith(shorter)) {
        matched += 1;
        break;
      }
    }
  }
  return matched / keywords.length;
}

export function scoreGrepBlock(block: GrepBlock, queryTerms: readonly string[]): number {
  const uniqueQuery = [...new Set(queryTerms.filter((t) => !STOPWORDS.has(t)))];
  const activeQuery = uniqueQuery.length > 0 ? uniqueQuery : [...new Set(queryTerms)];
  const querySet = new Set(activeQuery);

  let baseScore = 10.0;
  if (block.path.startsWith("src/")) baseScore += 5.0;

  const matchedTermsInBlock = new Set<string>();
  let maxDefMultiplier = 1.0;
  const stemParts = fileStemTokens(block.path);

  for (const entry of block.lines) {
    const lineTokens = tokenizeIdentifierTerms(entry.text);
    for (const token of lineTokens) {
      if (querySet.has(token)) {
        matchedTermsInBlock.add(token);
        baseScore += entry.matched ? 4.0 : 1.0;
      }
    }
    if (!entry.matched) continue;
    const symbol = detectLineSymbol(entry.text);
    if (symbol) {
      let defBoost = nodeKindBoost(symbol.kind);
      const symbolSubtokens = splitIdentifier(symbol.name);
      const symbolMatchesQuery =
        querySet.has(symbol.name.toLowerCase()) || symbolSubtokens.some((tok) => querySet.has(tok));
      if (symbolMatchesQuery) {
        const stemMatchesSymbol = symbolSubtokens.some((tok) => stemParts.has(tok));
        defBoost *= stemMatchesSymbol ? 4.5 : 3.0;
      }
      if (defBoost > maxDefMultiplier) maxDefMultiplier = defBoost;
    }
  }

  const coverage =
    activeQuery.length > 0 ? Math.min(1.0, matchedTermsInBlock.size / activeQuery.length) : 0;
  const coverageBoost = 1.0 + coverage ** 1.5 * 2.0;

  const stemRatio = stemMatchRatio(activeQuery, stemParts);
  const stemBoost = stemRatio >= 0.1 ? 1.0 + stemRatio : 1.0;

  return baseScore * maxDefMultiplier * coverageBoost * stemBoost * filePathPenalty(block.path);
}

/**
 * Ranks grep blocks using Semble + Probe scoring:
 * - Symbol definition boost + AST node kind boost
 * - File-stem & parent-directory match boost
 * - File coherence boost (0.2 * max_score * file_sum / max_file_sum)
 * - Path penalties (0.3x for tests/docs/examples/fixtures)
 * - Greedy file saturation decay (0.5^excess after 1st block per file) so a single noisy file
 *   never monopolizes the top of the output.
 */
export function rankGrepBlocks(blocks: readonly GrepBlock[], pattern: string): GrepBlock[] {
  if (blocks.length <= 1) return [...blocks];
  const terms = tokenizeIdentifierTerms(pattern);
  const rawScores = blocks.map((block) => scoreGrepBlock(block, terms));

  let maxScore = 0;
  const fileSum = new Map<string, number>();
  const bestIdxPerFile = new Map<string, number>();

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    const score = rawScores[i] ?? 0;
    if (score > maxScore) maxScore = score;
    fileSum.set(block.path, (fileSum.get(block.path) ?? 0) + score);
    const prevBest = bestIdxPerFile.get(block.path);
    if (prevBest === undefined || score > (rawScores[prevBest] ?? 0)) {
      bestIdxPerFile.set(block.path, i);
    }
  }

  let maxFileSum = 0;
  for (const sum of fileSum.values()) {
    if (sum > maxFileSum) maxFileSum = sum;
  }

  if (maxScore > 0 && maxFileSum > 0) {
    const coherenceUnit = maxScore * 0.2;
    for (const [path, idx] of bestIdxPerFile.entries()) {
      const sum = fileSum.get(path) ?? 0;
      rawScores[idx] = (rawScores[idx] ?? 0) + (coherenceUnit * sum) / maxFileSum;
    }
  }

  const order = blocks
    .map((block, index) => ({ block, index, score: rawScores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const fileSelected = new Map<string, number>();
  const decayed = order.map((entry) => {
    const seen = fileSelected.get(entry.block.path) ?? 0;
    fileSelected.set(entry.block.path, seen + 1);
    const effectiveScore = seen >= 1 ? entry.score * 0.5 ** seen : entry.score;
    return { ...entry, effectiveScore };
  });

  decayed.sort((a, b) => b.effectiveScore - a.effectiveScore || a.index - b.index);
  return decayed.map((entry) => entry.block);
}

export function renderGrepBlocks(
  blocks: readonly GrepBlock[],
  hasContext: boolean,
  limit: number,
): { lines: string[]; count: number; truncated: boolean } {
  const output: string[] = [];
  let count = 0;
  let truncated = false;
  const multiLineOutput = hasContext || blocks.some((b) => b.lines.length > 1);

  for (const block of blocks) {
    const remaining = limit - count;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (multiLineOutput && output.length > 0) {
      output.push("--");
    }
    let blockMatches = 0;
    for (const entry of block.lines) {
      if (entry.matched) {
        if (count >= limit) {
          truncated = true;
          break;
        }
        count += 1;
        blockMatches += 1;
      }
      const sep = entry.matched ? ":" : "-";
      output.push(`${entry.path}${sep}${entry.line}${sep} ${entry.text}`);
    }
    if (truncated && blockMatches === 0 && output.at(-1) === "--") {
      output.pop();
    }
  }
  return { lines: output, count, truncated };
}
