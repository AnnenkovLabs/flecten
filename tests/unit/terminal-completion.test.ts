import { expect, test } from "bun:test";
import { commandCompletion, commandWithCompletion } from "../../src/terminal/command-completion";

test("completion waits for an entire integer frame across arbitrary output chunks", () => {
  const marker = "__FLECTEN_DONE_nonce__";
  const echoed = `printf '${marker}%s' "$?"\n`;
  const frame = `${marker}-123\r\n`;
  let received = echoed;
  for (const char of frame.slice(0, -1)) {
    received += char;
    expect(commandCompletion(received, marker)).toBeNull();
  }
  received += "\nmore output";
  expect(commandCompletion(received, marker)).toEqual({
    start: echoed.length,
    end: echoed.length + frame.length,
    exitCode: -123,
  });
  for (const invalid of ["", "-", " ", "1x", "1.5", "9007199254740992"])
    expect(commandCompletion(`${marker}${invalid}\r\n`, marker)).toBeNull();
});

test("native shells receive their own completion protocol and preserve the raw command", () => {
  const raw = 'echo "hello"';
  const marker = "__FLECTEN_DONE_nonce__";
  expect(commandWithCompletion(raw, "C:\\Windows\\System32\\CMD.EXE", marker)).toBe(
    `${raw}\r\necho ${marker}%errorlevel%\r\n`,
  );
  const powershell = commandWithCompletion(raw, "powershell.exe", marker);
  expect(powershell.startsWith(`${raw}\r\n`)).toBe(true);
  expect(powershell).toContain("if ($?) { 0 } else { 1 }");
  expect(powershell).not.toContain("LASTEXITCODE");
  expect(commandWithCompletion(raw, "/bin/bash", marker)).toBe(
    `${raw}\nprintf '\\n${marker}%s\\n' "$?"\n`,
  );
});
