import type { MentionItem } from "./types";

function isSeparator(code: number): boolean {
  return (
    code === 32 ||
    code === 46 ||
    code === 45 ||
    code === 47 ||
    code === 58 ||
    code === 92 ||
    code === 95
  );
}

function isUpper(code: number): boolean {
  return (code >= 65 && code <= 90) || code === 1025 || (code >= 1040 && code <= 1071);
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function fuzzyScore(query: string, target: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return 0;

  const haystack = target.toLowerCase();
  let cursor = 0;
  let previous = -2;
  let streak = 0;
  let score = 0;

  for (let index = 0; index < needle.length; index += 1) {
    const code = needle.charCodeAt(index);
    let found = -1;

    for (let position = cursor; position < haystack.length; position += 1) {
      if (haystack.charCodeAt(position) === code) {
        found = position;
        break;
      }
    }

    if (found < 0) return null;

    score += 10;
    if (found === previous + 1) {
      streak += 1;
      score += streak * 6;
    } else {
      streak = 0;
    }

    if (found === 0) {
      score += 18;
    } else if (isSeparator(haystack.charCodeAt(found - 1))) {
      score += 12;
    }

    if (isUpper(target.charCodeAt(found))) score += 4;
    score -= Math.min(found - cursor, 8);

    previous = found;
    cursor = found + 1;
  }

  return score - Math.max(0, target.length - needle.length) * 0.1;
}

export function filterMentions(
  query: string,
  items: readonly MentionItem[],
  limit = 10,
): MentionItem[] {
  const needle = query.trim();
  if (needle.length === 0) return items.slice(0, limit);

  const scored: { item: MentionItem; score: number }[] = [];

  for (const item of items) {
    const pathScore = fuzzyScore(needle, item.path);
    const nameScore = fuzzyScore(needle, item.label ?? baseName(item.path));
    if (pathScore === null && nameScore === null) continue;

    const score = (nameScore ?? -100) * 3 + (pathScore ?? 0);
    scored.push({ item, score });
  }

  scored.sort(
    (left, right) => right.score - left.score || compareText(left.item.path, right.item.path),
  );

  return scored.slice(0, limit).map((entry) => entry.item);
}
