import { fromMarkdown } from "mdast-util-from-markdown";

/** Accept JSON or a single CommonMark code block, without repairing model data. */
export function twinResponse(text: string): unknown {
  try {
    return JSON.parse(text.trim()) as unknown;
  } catch {
    const nodes = fromMarkdown(text).children;
    const node = nodes[0];
    if (
      nodes.length === 1 &&
      node?.type === "code" &&
      (node.lang === "json" || node.lang === null) &&
      !node.meta
    ) {
      try {
        return JSON.parse(node.value) as unknown;
      } catch {
        // Invalid or truncated JSON must never become a saved preference or verdict.
      }
    }
    throw new Error("Twin returned invalid JSON. Retry the request; the profile was not changed.");
  }
}
