/** Line numbers for the gutter, one per line of text. */
export function lineNumbers(text: string): string {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return lines.map((_, index) => String(index + 1)).join("\n");
}

/** Folder and name apart, so a long path loses its middle and keeps the file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}
