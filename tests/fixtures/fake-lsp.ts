import { writeFileSync } from "node:fs";

interface Message {
  id?: number | string;
  method?: string;
  params?: unknown;
}

const marker = process.env.FAKE_LSP_MARKER;
const secret = process.env.FAKE_LSP_SECRET;
const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;
const delayMs = Number(process.env.FAKE_LSP_DELAY_MS ?? "0");
let openedUri = "file:///fake.ts";

function send(message: unknown): void {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function result(id: number | string, value: unknown): void {
  send({ jsonrpc: "2.0", id, result: value });
}

function respond(action: () => void): void {
  if (Number.isFinite(delayMs) && delayMs > 0) {
    setTimeout(action, delayMs);
    return;
  }
  action();
}

function failure(id: number | string, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticMessage(): string {
  const parts = ["fake diagnostic"];
  if (tag) parts.push(tag);
  if (secret) parts.push(`leaked:${secret}`);
  return parts.join(" ");
}

function handle(message: Message): void {
  const id = message.id;
  const method = message.method;
  if (method === "initialize") {
    if (id === undefined) return;
    result(id, {
      capabilities: {
        definitionProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        renameProvider: true,
      },
      serverInfo: { name: "fake-lsp", version: "1.0.0" },
    });
    if (process.env.FAKE_LSP_EXIT_AFTER_INITIALIZE === "1") {
      setTimeout(() => process.exit(7), 100);
    }
    return;
  }
  if (method === "initialized") return;
  if (method === "textDocument/didOpen") {
    if (isRecord(message.params) && isRecord(message.params.textDocument)) {
      const uri = message.params.textDocument.uri;
      if (typeof uri === "string") openedUri = uri;
    }
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: openedUri,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 5 },
            },
            severity: 1,
            message: diagnosticMessage(),
            source: "fake",
          },
        ],
      },
    });
    return;
  }
  if (method === "textDocument/definition") {
    if (id === undefined) return;
    respond(() =>
      result(id, [
        {
          uri: openedUri,
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
        },
        {
          uri: "file:///other.ts",
          range: { start: { line: 3, character: 1 }, end: { line: 3, character: 4 } },
        },
      ]),
    );
    return;
  }
  if (method === "textDocument/references") {
    if (id === undefined) return;
    respond(() =>
      result(id, [
        {
          uri: openedUri,
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
        },
        {
          uri: openedUri,
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
        },
      ]),
    );
    return;
  }
  if (method === "textDocument/documentSymbol") {
    if (id === undefined) return;
    respond(() =>
      result(id, [
        {
          name: "x",
          kind: 13,
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
          selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
          children: [],
        },
        {
          name: "inner",
          kind: 12,
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 9 } },
          selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } },
        },
      ]),
    );
    return;
  }
  if (method === "textDocument/rename") {
    if (id === undefined) return;
    const newName =
      isRecord(message.params) && typeof message.params.newName === "string"
        ? message.params.newName
        : "renamed";
    respond(() =>
      result(id, {
        changes: {
          [openedUri]: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              newText: newName,
            },
          ],
        },
      }),
    );
    return;
  }
  if (method === "shutdown") {
    if (id !== undefined) result(id, null);
    return;
  }
  if (method === "exit") {
    if (marker) writeFileSync(marker, "exit");
    process.exit(0);
  }
  if (method === "$/cancelRequest") return;
  if (id !== undefined) failure(id, -32601, `Unknown method: ${method ?? "(none)"}`);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

function headerEnd(buffer: Uint8Array): number {
  for (let index = 0; index + 3 < buffer.length; index += 1) {
    if (
      buffer[index] === 13 &&
      buffer[index + 1] === 10 &&
      buffer[index + 2] === 13 &&
      buffer[index + 3] === 10
    ) {
      return index;
    }
  }
  return -1;
}

function contentLength(header: string): number {
  for (const line of header.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== "content-length") continue;
    return Number.parseInt(line.slice(colon + 1).trim(), 10);
  }
  return -1;
}

async function main(): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer = concat(buffer, value);
    for (;;) {
      const end = headerEnd(buffer);
      if (end < 0) break;
      const length = contentLength(decoder.decode(buffer.subarray(0, end)));
      if (length < 0) process.exit(1);
      const total = end + 4 + length;
      if (buffer.length < total) break;
      const body = decoder.decode(buffer.subarray(end + 4, total));
      buffer = buffer.subarray(total);
      handle(JSON.parse(body) as Message);
    }
  }
}

async function formatter(): Promise<void> {
  const source = process.argv.at(-1);
  if (!source) process.exit(1);
  const text = await Bun.file(source).text();
  const formatterDelay = Number(process.env.FAKE_FORMATTER_DELAY_MS ?? "0");
  if (Number.isFinite(formatterDelay) && formatterDelay > 0) await Bun.sleep(formatterDelay);
  const formatted = text.replace(/const\s+x\s*=\s*1;/, "const x = 1;");
  process.stdout.write(secret ? `${formatted}\nleaked:${secret}` : formatted);
}

if (process.argv.includes("--formatter")) await formatter();
else await main();
