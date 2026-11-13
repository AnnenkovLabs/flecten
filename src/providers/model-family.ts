// Version numbers read from model ids, for models whose config does not state the behavior.
// ponytail: these fallbacks only apply when the catalog and the user config are silent.

const ANTHROPIC_FAMILIES = ["opus", "sonnet", "haiku", "fable", "mythos"];

export interface ModelVersion {
  major: number;
  /** Absent when the id has no minor part. */
  minor?: number;
}

/** Digits at `start`, or "" when there are none. */
function digitsAt(text: string, start: number): string {
  let end = start;
  for (let char = text[end]; char !== undefined && char >= "0" && char <= "9"; char = text[end]) {
    end += 1;
  }
  return text.slice(start, end);
}

/** `family-N` or `family-N-M`, like `sonnet-4-5` in `claude-sonnet-4-5-20250929`. */
function afterFamily(id: string, family: string): { at: number; version: ModelVersion } | null {
  const marker = `${family}-`;
  for (let at = id.indexOf(marker); at >= 0; at = id.indexOf(marker, at + 1)) {
    const majorStart = at + marker.length;
    const major = digitsAt(id, majorStart);
    if (!major) continue;
    const next = majorStart + major.length;
    const minor = id[next] === "-" ? digitsAt(id, next + 1) : "";
    return { at, version: { major: Number(major), ...(minor ? { minor: Number(minor) } : {}) } };
  }
  return null;
}

/** The leftmost `family-N[-M]` in the id. */
export function familyFirstVersion(modelId: string): ModelVersion | undefined {
  let best: { at: number; version: ModelVersion } | null = null;
  for (const family of ANTHROPIC_FAMILIES) {
    const found = afterFamily(modelId, family);
    if (found && (!best || found.at < best.at)) best = found;
  }
  return best?.version;
}

function familyAt(id: string, start: number): boolean {
  return ANTHROPIC_FAMILIES.some((family) => id.startsWith(family, start));
}

/** `claude-N[-M]-family`, the older order, like `claude-3-5-sonnet-20241022`. */
export function versionFirstVersion(modelId: string): ModelVersion | undefined {
  const marker = "claude-";
  for (let at = modelId.indexOf(marker); at >= 0; at = modelId.indexOf(marker, at + 1)) {
    const majorStart = at + marker.length;
    const major = digitsAt(modelId, majorStart);
    if (!major || modelId[majorStart + major.length] !== "-") continue;
    const next = majorStart + major.length + 1;
    const minor = digitsAt(modelId, next);
    if (
      minor &&
      modelId[next + minor.length] === "-" &&
      familyAt(modelId, next + minor.length + 1)
    ) {
      return { major: Number(major), minor: Number(minor) };
    }
    if (familyAt(modelId, next)) return { major: Number(major) };
  }
  return undefined;
}

/** OpenAI reasoning families take `max_completion_tokens`: gpt-5 and later, o1 to o9. */
export function usesCompletionTokens(modelId: string): boolean {
  if (["gpt-5", "gpt-6", "gpt-7"].some((prefix) => modelId.startsWith(prefix))) return true;
  const second = modelId[1];
  return modelId[0] === "o" && second !== undefined && second >= "1" && second <= "9";
}
