import type { SubagentSpec } from "./types";

export function mergeSubagentSpecs(
  builtins: readonly SubagentSpec[],
  definitions: readonly SubagentSpec[],
): SubagentSpec[] {
  const merged = new Map<string, SubagentSpec>();
  for (const spec of builtins) {
    if (merged.has(spec.id)) throw new Error(`subagent already registered: ${spec.id}`);
    merged.set(spec.id, spec);
  }
  const files = new Map<string, string>();
  for (const spec of definitions) {
    const previous = files.get(spec.id);
    if (previous !== undefined) {
      throw new Error(
        `duplicate subagent definition: ${spec.id} (${previous}, ${spec.sourcePath ?? spec.id})`,
      );
    }
    files.set(spec.id, spec.sourcePath ?? spec.id);
    merged.set(spec.id, spec);
  }
  return [...merged.values()];
}

export class SubagentRegistry {
  readonly #specs = new Map<string, SubagentSpec>();

  constructor(specs: readonly SubagentSpec[] = []) {
    for (const spec of specs) this.register(spec);
  }

  register(spec: SubagentSpec): void {
    if (this.#specs.has(spec.id)) {
      throw new Error(`subagent already registered: ${spec.id}`);
    }
    this.#specs.set(spec.id, spec);
  }

  get(id: string): SubagentSpec | undefined {
    return this.#specs.get(id);
  }

  list(): SubagentSpec[] {
    return [...this.#specs.values()];
  }
}
