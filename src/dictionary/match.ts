import type { DictionaryMatch, DictionaryRecord } from "../../shared/dictionary";
import { allowsTypo, deletions, dictionaryTokens, keyboardVariants, oneTypo } from "./normalize";

interface Candidate extends DictionaryMatch {
  start: number;
  end: number;
  cost: number;
}

/** Declared aliases, Unicode boundaries, local overrides and unambiguous one-typo recovery. */
export function matchDictionary(
  prompt: string,
  entries: readonly DictionaryRecord[],
): DictionaryMatch[] {
  const effective = new Map<string, DictionaryRecord>();
  for (const entry of entries) {
    if (entry.source === "local" || !effective.has(entry.id)) effective.set(entry.id, entry);
  }
  const exact = new Map<string, DictionaryMatch[]>();
  const fuzzy = new Map<string, Set<string>>();
  let spanLimit = 1;
  for (const entry of effective.values()) {
    for (const alias of [entry.term, ...entry.aliases]) {
      const parts = dictionaryTokens(alias);
      const key = parts.join("");
      if (parts.length === 0) continue;
      spanLimit = Math.max(spanLimit, parts.length);
      const matches = exact.get(key) ?? [];
      matches.push({ entry, matchedAlias: alias });
      exact.set(key, matches);
    }
  }
  for (const key of exact.keys()) {
    // ponytail: fuzzy recovery covers 8-64 characters and one edit; widen only with measured false-positive data.
    if (!allowsTypo(key)) continue;
    for (const deletion of [key, ...deletions(key)]) {
      const keys = fuzzy.get(deletion) ?? new Set<string>();
      keys.add(key);
      fuzzy.set(deletion, keys);
    }
  }
  const words = dictionaryTokens(prompt);
  const candidates: Candidate[] = [];
  for (let start = 0; start < words.length; start += 1) {
    let key = "";
    for (let end = start; end < Math.min(words.length, start + spanLimit); end += 1) {
      key += words[end];
      if ([...key].length > 160) break;
      const variants = [...key].length >= 5 ? keyboardVariants(key) : [key];
      let matches: { match: DictionaryMatch; cost: number }[] = [];
      for (const [index, variant] of variants.entries()) {
        for (const match of exact.get(variant) ?? [])
          matches.push({ match, cost: index === 0 ? 0 : 1 });
      }
      if (matches.length === 0 && allowsTypo(key)) {
        for (const [index, variant] of variants.entries()) {
          const keys = new Set<string>();
          for (const deletion of [variant, ...deletions(variant)]) {
            for (const alias of fuzzy.get(deletion) ?? []) keys.add(alias);
          }
          for (const alias of keys) {
            if (!oneTypo(variant, alias)) continue;
            for (const match of exact.get(alias) ?? [])
              matches.push({ match, cost: index === 0 ? 2 : 3 });
          }
        }
      }
      const best = Math.min(...matches.map((match) => match.cost));
      matches = matches.filter((match) => match.cost === best);
      if (best <= 1 && matches.some(({ match }) => match.entry.source === "local")) {
        matches = matches.filter(({ match }) => match.entry.source === "local");
      }
      const ids = new Set(matches.map(({ match }) => match.entry.id));
      if (ids.size !== 1) continue;
      const chosen = matches[0];
      if (chosen) candidates.push({ ...chosen.match, start, end, cost: chosen.cost });
    }
  }
  candidates.sort(
    (a, b) =>
      a.cost - b.cost ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start ||
      a.entry.id.localeCompare(b.entry.id),
  );
  const occupied = new Set<number>();
  const found = new Map<string, Candidate>();
  for (const candidate of candidates) {
    let overlap = false;
    for (let index = candidate.start; index <= candidate.end; index += 1) {
      if (occupied.has(index)) overlap = true;
    }
    if (overlap) continue;
    for (let index = candidate.start; index <= candidate.end; index += 1) occupied.add(index);
    if (!found.has(candidate.entry.id)) found.set(candidate.entry.id, candidate);
  }
  return [...found.values()]
    .sort((a, b) => a.start - b.start)
    .map(({ entry, matchedAlias }) => ({ entry, matchedAlias }));
}
