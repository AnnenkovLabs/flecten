import { z } from "zod";
import { saveProjectFile } from "./file-edit";
import { previewFile } from "./file-preview";
import { literalMatches, SearchOptions, searchWorkspace } from "./workspace-search";

const Options = SearchOptions.extend({ replacement: z.string().max(10000) });
const File = z.object({
  path: z.string().min(1),
  expectedHash: z.string().length(64),
  count: z.number().int().positive(),
});
const Command = z.discriminatedUnion("action", [
  Options.extend({ action: z.literal("preview") }),
  Options.extend({ action: z.literal("apply"), files: z.array(File).min(1).max(500) }),
]);

function replace(text: string, options: z.infer<typeof Options>): { text: string; count: number } {
  const chunks: string[] = [];
  let previous = 0;
  let count = 0;
  for (const match of literalMatches(text, options)) {
    chunks.push(text.slice(previous, match.from), options.replacement);
    previous = match.to;
    count += 1;
  }
  chunks.push(text.slice(previous));
  return { text: chunks.join(""), count };
}

/** Preview fixes the exact files and hashes; apply cannot silently replace a newer version. */
export async function replaceWorkspace(cwd: string, input: unknown): Promise<unknown> {
  const command = Command.parse(input);
  if (command.action === "preview") {
    const result = await searchWorkspace(cwd, command);
    if (result.limited)
      throw new Error("Уточните поиск перед заменой: показаны не все совпадения.");
    const files = [];
    for (const path of new Set(result.matches.map((match) => match.path))) {
      const file = await previewFile(cwd, path);
      if (!file.hash)
        throw new Error(`${path}: ${file.readOnlyReason ?? "Файл доступен только для чтения"}`);
      const updated = replace(file.text, command);
      if (updated.count) files.push({ path, expectedHash: file.hash, count: updated.count });
    }
    return { files };
  }
  const completed: string[] = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const planned of command.files) {
    try {
      const current = await previewFile(cwd, planned.path);
      if (current.hash !== planned.expectedHash)
        throw new Error("Файл изменился после предпросмотра. Повторите поиск.");
      const updated = replace(current.text, command);
      if (updated.count !== planned.count)
        throw new Error("Число совпадений изменилось. Повторите поиск.");
      await saveProjectFile(cwd, {
        path: planned.path,
        text: updated.text,
        expectedHash: planned.expectedHash,
      });
      completed.push(planned.path);
    } catch (error) {
      errors.push({
        path: planned.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { completed, errors };
}
