import {
  type CodeSymbol,
  enclosingSymbolForLine,
  extractCodeSymbols,
  splitIdentifier,
  tokenizeIdentifierTerms,
} from "../util/code-symbols";
import {
  detectLineSymbol,
  fileStemTokens,
  type GrepBlock,
  type GrepRenderLine,
  nodeKindBoost,
  STOPWORDS,
} from "./ranking";

const MAX_AUTO_DEF_BODY_LINES = 25;

/**
 * Expands context around a match in a source file so that when context > 0,
 * the enclosing function signature line is included in standard ripgrep format.
 */
export function expandFileMatchIndices(
  lines: readonly string[],
  matchIndices: readonly number[],
  contextLines: number,
  limit: number,
  display: string,
  formatLine: (line: string) => string,
): { blocks: GrepBlock[]; matchesUsed: number; truncated: boolean } {
  const symbols = contextLines > 0 ? extractCodeSymbols(lines) : [];
  const matchingSet = new Set(matchIndices);
  const blocks: GrepBlock[] = [];
  let matchesUsed = 0;
  let truncated = false;

  let currentLines: GrepRenderLine[] = [];
  let lastLine = -2;
  let currentMatchCount = 0;

  const flush = (): void => {
    if (currentLines.length === 0) return;
    blocks.push({
      path: display,
      firstLine: currentLines[0]?.line ?? 1,
      matchCount: currentMatchCount,
      lines: currentLines,
    });
    currentLines = [];
    lastLine = -2;
    currentMatchCount = 0;
  };

  for (const index of matchIndices) {
    if (matchesUsed >= limit) {
      truncated = true;
      break;
    }
    matchesUsed += 1;

    let from = Math.max(0, index - contextLines);
    const to = Math.min(lines.length - 1, index + contextLines);
    if (contextLines > 0) {
      const enclosing = enclosingSymbolForLine(symbols, index + 1);
      if (enclosing && index + 1 - enclosing.startLine <= Math.max(contextLines + 6, 12)) {
        from = Math.min(from, enclosing.startLine - 1);
      }
    }

    if (currentLines.length > 0 && from > lastLine + 1) {
      flush();
    }

    const start = currentLines.length > 0 ? Math.max(from, lastLine + 1) : from;
    for (let lineIdx = start; lineIdx <= to; lineIdx += 1) {
      const isMatch = matchingSet.has(lineIdx);
      if (isMatch) currentMatchCount += 1;
      currentLines.push({
        path: display,
        line: lineIdx + 1,
        matched: isMatch,
        text: formatLine(lines[lineIdx] ?? ""),
      });
      lastLine = lineIdx;
    }
  }
  flush();

  return { blocks, matchesUsed, truncated };
}

/**
 * Expands the top-ranked grep blocks in standard ripgrep format:
 * - When contextLines > 0: prepends lines up to the enclosing function signature.
 * - When contextLines === 0: for the top 3 definition matches whose query matches the symbol name
 *   and whose body is compact (<= 25 lines), appends the body lines in standard `path-line- text`
 *   format, unless `reads.markSymbolShown` reports the exact AST block was already shown in this session.
 */
export function enrichTopRankedBlocks(
  blocks: readonly GrepBlock[],
  contextLines: number,
  pattern: string,
  getFileLines: (relPath: string) => { fullPath: string; lines: readonly string[] } | undefined,
  formatLine: (line: string) => string,
  reads?: {
    markSymbolShown?(path: string, startLine: number, endLine: number, body: string): boolean;
  },
): GrepBlock[] {
  if (blocks.length === 0) return [];
  const out = [...blocks];
  const queryTerms = new Set(tokenizeIdentifierTerms(pattern));
  const symbolCache = new Map<string, CodeSymbol[]>();
  const topCount = Math.min(5, out.length);
  let expandedDefinitions = 0;

  for (let i = 0; i < topCount; i += 1) {
    const block = out[i];
    if (!block || block.lines.length === 0) continue;
    const loaded = getFileLines(block.path);
    if (!loaded) continue;
    const { fullPath, lines } = loaded;

    let symbols = symbolCache.get(block.path);
    if (!symbols) {
      symbols = extractCodeSymbols(lines);
      symbolCache.set(block.path, symbols);
    }

    const firstMatched = block.lines.find((entry) => entry.matched) ?? block.lines[0];
    if (!firstMatched) continue;
    const enclosing = enclosingSymbolForLine(symbols, firstMatched.line);
    if (!enclosing) continue;

    if (contextLines > 0) {
      if (
        enclosing.startLine < block.firstLine &&
        firstMatched.line - enclosing.startLine <= Math.max(contextLines + 6, 12)
      ) {
        const prepended: GrepRenderLine[] = [];
        for (let lineNo = enclosing.startLine; lineNo < block.firstLine; lineNo += 1) {
          prepended.push({
            path: block.path,
            line: lineNo,
            matched: false,
            text: formatLine(lines[lineNo - 1] ?? ""),
          });
        }
        out[i] = {
          ...block,
          firstLine: enclosing.startLine,
          lines: [...prepended, ...block.lines],
        };
      }
      continue;
    }

    if (expandedDefinitions >= 3) continue;
    if (firstMatched.line !== enclosing.startLine) continue;
    const span = enclosing.endLine - enclosing.startLine + 1;
    if (span <= 1 || span > MAX_AUTO_DEF_BODY_LINES) continue;

    const symTokens = splitIdentifier(enclosing.name);
    const matchesSymbol =
      queryTerms.has(enclosing.name.toLowerCase()) || symTokens.some((tok) => queryTerms.has(tok));
    if (!matchesSymbol) continue;

    const rawBody = lines.slice(enclosing.startLine - 1, enclosing.endLine).join("\n");
    if (reads?.markSymbolShown?.(fullPath, enclosing.startLine, enclosing.endLine, rawBody)) {
      continue;
    }

    const lastBlockLine = block.lines.at(-1)?.line ?? firstMatched.line;
    if (enclosing.endLine <= lastBlockLine) continue;

    const appended: GrepRenderLine[] = [];
    for (let lineNo = lastBlockLine + 1; lineNo <= enclosing.endLine; lineNo += 1) {
      appended.push({
        path: block.path,
        line: lineNo,
        matched: false,
        text: formatLine(lines[lineNo - 1] ?? ""),
      });
    }
    out[i] = {
      ...block,
      lines: [...block.lines, ...appended],
    };
    expandedDefinitions += 1;
  }

  return out;
}

/**
 * Okapi BM25 + Probe coverage boost (k1=1.5, b=0.5) multi-term fallback for queries with 2+ terms
 * when exact regex/literal matching yields 0 hits.
 * Preserves 100% standard ripgrep output format (`path:line: text`).
 */
export function findBm25LinesInFile(
  lines: readonly string[],
  queryTerms: readonly string[],
  filePath = "",
): Array<{ index: number; score: number }> {
  const filtered = [...new Set(queryTerms.filter((t) => t.length >= 2 && !STOPWORDS.has(t)))];
  if (filtered.length < 2) return [];

  const k1 = 1.5;
  const b = 0.5;
  const avgdl = 12;
  const stemParts = filePath ? fileStemTokens(filePath) : new Set<string>();

  const df = new Map<string, number>();
  const lineTokensList: Array<string[]> = new Array(lines.length);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const toks = line.trim().length > 0 ? tokenizeIdentifierTerms(line) : [];
    lineTokensList[i] = toks;
    const unique = new Set(toks);
    for (const term of filtered) {
      if (unique.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const nDocs = Math.max(1, lines.length);
  const idf = new Map<string, number>();
  for (const term of filtered) {
    const docFreq = df.get(term) ?? 0;
    const val = Math.log(1 + (nDocs - docFreq + 0.5) / (docFreq + 0.5));
    idf.set(term, Math.max(0.2, val));
  }

  const scored: Array<{ index: number; score: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineToks = lineTokensList[index] ?? [];
    if (lineToks.length === 0) continue;

    const windowToks = [
      ...(lineTokensList[index - 1] ?? []),
      ...lineToks,
      ...(lineTokensList[index + 1] ?? []),
      ...stemParts,
    ];

    const tfMap = new Map<string, number>();
    for (const tok of windowToks) {
      tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1);
    }
    const lineSet = new Set(lineToks);

    let matchedInWindow = 0;
    let matchedOnLine = 0;
    let bm25 = 0;
    const docLen = Math.max(1, windowToks.length);

    for (const term of filtered) {
      const freq = tfMap.get(term) ?? 0;
      if (freq > 0) {
        matchedInWindow += 1;
        const termIdf = idf.get(term) ?? 1.0;
        const tfPart = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (docLen / avgdl)));
        bm25 += termIdf * tfPart;
      }
      if (lineSet.has(term)) matchedOnLine += 1;
    }

    const minRequired = Math.max(2, Math.ceil(filtered.length * 0.5));
    if (matchedInWindow < minRequired || matchedOnLine === 0) continue;

    const coverage = matchedInWindow / filtered.length;
    const coverageBoost = 1.0 + coverage ** 1.5 * 2.0;
    const sym = detectLineSymbol(line);
    const nodeBoost = sym ? nodeKindBoost(sym.kind) * 1.5 : 1.0;

    scored.push({
      index,
      score: bm25 * coverageBoost * nodeBoost,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: Array<{ index: number; score: number }> = [];
  for (const item of scored) {
    if (picked.some((existing) => Math.abs(existing.index - item.index) <= 2)) continue;
    picked.push(item);
    if (picked.length >= 5) break;
  }
  return picked.sort((a, b) => a.index - b.index);
}
