const segmenter = new Intl.Segmenter("und", { granularity: "word" });
const separators = new Set(["-", "‐", "‑", "‒", "–"]);
const layouts = [
  ["`qwertyuiop[]asdfghjkl;'zxcvbnm,.", "ёйцукенгшщзхъфывапролджэячсмитьбю"],
  ["`qwertyuiop[]asdfghjkl;'zxcvbnm,.", "'йцукенгшщзхїфівапролджєячсмитьбю"],
] as const;

export function dictionaryTokens(text: string): string[] {
  return [...segmenter.segment(text.normalize("NFKC").toLocaleLowerCase("und"))]
    .filter((part) => part.segment.trim().length > 0 && !separators.has(part.segment))
    .map((part) => part.segment);
}

/** Physical English/Russian/Ukrainian keyboard layouts; translation comes from declared aliases. */
export function keyboardVariants(text: string): string[] {
  const variants = new Set([text]);
  for (const [english, cyrillic] of layouts) {
    for (const [from, to] of [
      [english, cyrillic],
      [cyrillic, english],
    ]) {
      if (!from || !to) continue;
      variants.add(
        [...text]
          .map((char) => {
            const index = from.indexOf(char);
            return index < 0 ? char : to[index];
          })
          .join(""),
      );
    }
  }
  return [...variants];
}

export function allowsTypo(value: string): boolean {
  const length = [...value].length;
  return (
    length >= 8 &&
    length <= 64 &&
    [...value].every((char) => [...segmenter.segment(char)].every((part) => part.isWordLike))
  );
}

export function deletions(value: string): string[] {
  const chars = [...value];
  return chars.map((_, index) => [...chars.slice(0, index), ...chars.slice(index + 1)].join(""));
}

/** At most one insertion, deletion, substitution or neighboring transposition. */
export function oneTypo(left: string, right: string): boolean {
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > 1) return false;
  let index = 0;
  while (index < Math.min(a.length, b.length) && a[index] === b[index]) index += 1;
  if (index === Math.min(a.length, b.length)) return true;
  if (a.length !== b.length) {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    return longer.slice(index + 1).join("") === shorter.slice(index).join("");
  }
  return (
    a.slice(index + 1).join("") === b.slice(index + 1).join("") ||
    (a[index] === b[index + 1] &&
      a[index + 1] === b[index] &&
      a.slice(index + 2).join("") === b.slice(index + 2).join(""))
  );
}
