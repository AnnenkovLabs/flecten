import { fileURLToPath } from "node:url";
import { executable, runProcess } from "./process.mjs";

/** AT-SPI is optional: canvas and apps without an accessibility bridge remain operable by pixels. */
export async function accessibility(env, signal) {
  if (!executable("python3")) return { available: false, reason: "Python 3 is not installed." };
  try {
    const output = await runProcess("python3", [fileURLToPath(new URL("./accessibility.py", import.meta.url))], {
      env, signal, timeoutMs: 2500, maxBytes: 128_000,
    });
    const value = JSON.parse(output.toString("utf8"));
    if (!value || value.available !== true || !Array.isArray(value.nodes) || value.nodes.length > 160 || typeof value.truncated !== "boolean")
      throw new Error("Invalid accessibility result");
    for (const node of value.nodes) {
      if (!node || typeof node.role !== "string" || node.role.length > 80 || typeof node.name !== "string" || node.name.length > 200 || typeof node.depth !== "number" || !Number.isInteger(node.depth) || node.depth < 0 || node.depth > 12)
        throw new Error("Invalid accessibility node");
      if (node.bounds && (![node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height].every(Number.isFinite)))
        throw new Error("Invalid accessibility bounds");
      if (node.text !== undefined && (typeof node.text !== "string" || node.text.length > 300))
        throw new Error("Invalid accessibility text");
      if (Object.keys(node).some((key) => !["role", "name", "depth", "bounds", "text"].includes(key)))
        throw new Error("Unexpected accessibility field");
    }
    return { available: true, source: "AT-SPI", nodes: value.nodes, truncated: value.truncated };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { available: false, reason: error.code === "TIMED_OUT" ? "Accessibility tree timed out; use the screenshot." : "AT-SPI is unavailable; use the screenshot." };
  }
}
