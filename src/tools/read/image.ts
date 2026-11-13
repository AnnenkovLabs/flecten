import { readImage } from "../../core/image";
import type { ToolResult } from "../../core/types";
import type { ToolContext } from "../types";

export async function runReadImage(
  path: string,
  focus: string | undefined,
  context: Pick<ToolContext, "inspectImage" | "saveMedia" | "signal">,
): Promise<ToolResult> {
  const image = await readImage(path);
  const data = { kind: "read", path, mediaType: image.mediaType };
  if (context.inspectImage) {
    const description = await context.inspectImage(image, focus, context.signal);
    return { ok: true, output: `Image: ${path}\n\n${description}`, data };
  }
  if (!context.saveMedia)
    return { ok: false, output: "", error: "Image reading requires session media storage." };
  const attachments = await context.saveMedia([image]);
  return { ok: true, output: `Image: ${path}`, attachments, data };
}
