const ACRONYMS = new Set([
  "glm",
  "gpt",
  "llm",
  "ai",
  "api",
  "vl",
  "vlm",
  "moe",
  "it",
  "oss",
  "tts",
  "asr",
  "ocr",
  "sdk",
  "fp8",
  "fp16",
  "mxfp4",
  "awq",
  "gguf",
]);

export function formatModelName(id: string): string {
  const raw = id.replace(/^~/, "").split("/").filter(Boolean).at(-1) ?? id;
  const parts = raw.split(/[-_\s]+/).filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (
      /^\d$/.test(part) &&
      last &&
      /^(?:\d+(?:\.\d+)?|k\d+(?:\.\d+)?|v\d+(?:\.\d+)?)$/i.test(last)
    ) {
      merged[merged.length - 1] = `${last}.${part}`;
      continue;
    }
    merged.push(part);
  }
  return merged
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (/^v\d+(\.\d+)?$/i.test(part)) return part.toUpperCase();
      if (/^k\d+(\.\d+)?$/i.test(lower)) return `K${part.slice(1)}`;
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      if (/^\d+b$/i.test(part)) return part.toUpperCase();
      if (/[A-Z]/.test(part)) return part;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "provider"
  );
}
