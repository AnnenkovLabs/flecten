import { shellName } from "./shell";

/** Explicit shell protocol: a per-command nonce followed by an integer and LF. */
export interface CommandCompletion {
  start: number;
  end: number;
  exitCode: number;
}

export function commandWithCompletion(command: string, shell: string, marker: string): string {
  switch (shellName(shell).toLowerCase()) {
    case "cmd":
      return `${command}\r\necho ${marker}%errorlevel%\r\n`;
    case "powershell":
    case "pwsh":
      // PowerShell -Command reports the last pipeline's success as 0/1.
      // LASTEXITCODE is sticky across cmdlets and cannot represent that status.
      return `${command}\r\n$__liquidCode = if ($?) { 0 } else { 1 }; Write-Output ("${marker}" + $__liquidCode)\r\n`;
    default:
      return `${command}\nprintf '\\n${marker}%s\\n' "$?"\n`;
  }
}

/** Incomplete chunks and echoed commands are not completion frames. */
export function commandCompletion(text: string, marker: string): CommandCompletion | null {
  let start = text.indexOf(marker);
  while (start >= 0) {
    const valueStart = start + marker.length;
    let cursor = valueStart;
    if (text[cursor] === "-") cursor += 1;
    const digitsStart = cursor;
    while (cursor < text.length && text.charAt(cursor) >= "0" && text.charAt(cursor) <= "9")
      cursor += 1;
    const valueEnd = cursor;
    if (text[cursor] === "\r") cursor += 1;
    if (valueEnd > digitsStart && text[cursor] === "\n") {
      const exitCode = Number(text.slice(valueStart, valueEnd));
      if (Number.isSafeInteger(exitCode)) return { start, end: cursor + 1, exitCode };
    }
    start = text.indexOf(marker, start + marker.length);
  }
  return null;
}
