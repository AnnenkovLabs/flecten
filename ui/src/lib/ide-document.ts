import { z } from "zod";
import type { AgentFilePreview } from "./types";

export interface IdeDocument {
  path: string;
  text: string;
  savedText: string;
  file: AgentFilePreview | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  changedOnDisk: boolean;
}

export const ideFileSchema = z.object({
  path: z.string(),
  size: z.number().nonnegative(),
  text: z.string(),
  truncated: z.boolean(),
  binary: z.boolean(),
  hash: z.string().optional(),
  readOnlyReason: z.string().optional(),
});

export function parseIdeFile(value: unknown): AgentFilePreview {
  const { hash, readOnlyReason, ...file } = ideFileSchema.parse(value);
  return {
    ...file,
    ...(hash === undefined ? {} : { hash }),
    ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
  };
}

export function isDirty(document: IdeDocument): boolean {
  return document.text !== document.savedText;
}

export function replaceFromDisk(document: IdeDocument, file: AgentFilePreview): void {
  document.file = file;
  document.text = file.text;
  document.savedText = file.text;
  document.changedOnDisk = false;
  document.error = null;
}

/** Preserve an unsaved draft even when the agent replaces the same file. */
export function refreshDocument(document: IdeDocument, file: AgentFilePreview): void {
  if (isDirty(document)) {
    document.changedOnDisk = file.hash !== document.file?.hash || file.text !== document.savedText;
  } else {
    replaceFromDisk(document, file);
  }
}
