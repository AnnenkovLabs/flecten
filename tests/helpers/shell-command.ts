/** Trusted fixture arguments for the platform's default shell, not JSON-escaped command text. */
export function bunFileCommand(path: string, args: readonly string[] = []): string {
  const quote =
    process.platform === "win32"
      ? (value: string) => `"${value}"`
      : (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return [process.execPath, path, ...args].map(quote).join(" ");
}
