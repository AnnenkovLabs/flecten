/**
 * POSIX shell lexer for policy checks. It does not execute or expand anything: it finds the
 * simple commands a line would run, including nested `$(...)`, backticks, subshells and
 * `sh -c` strings, so policies reason about argv instead of matching text.
 */

export type RedirectOp = ">" | ">>" | "<" | "<<" | "<<<" | ">&" | "<&" | "&>" | "&>>" | "<>" | ">|";

export interface ShellRedirect {
  op: RedirectOp;
  fd: number | null;
  target: string;
}

export interface ShellWord {
  /** Value after quote removal. Expansions stay literal: `$HOME` remains `$HOME`. */
  value: string;
  /** True when part of the word came from `$`, a glob or `~`, so the value is not final. */
  dynamic: boolean;
  /** True when the word holds `$`, `~` or a substitution: its value is known only at run time. */
  expands: boolean;
  /** True when the word holds an unquoted `*`, `?` or `[`. */
  glob: boolean;
}

export interface SimpleCommand {
  argv: ShellWord[];
  assignments: string[];
  redirects: ShellRedirect[];
}

export interface ShellParse {
  commands: SimpleCommand[];
  /** False when quotes or substitutions were left open. */
  complete: boolean;
}

const OPERATOR_CHARS = new Set([";", "&", "|", "(", ")", "\n"]);
const REDIRECT_CHARS = new Set([">", "<"]);
const BLANKS = new Set([" ", "\t", "\r"]);
const GLOB_CHARS = new Set(["*", "?", "["]);
const RESERVED = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "esac",
  "time",
  "function",
  "[[",
  "]]",
]);
/** Clauses whose words are data, not a command: `for x in a b`, `case $x in`. */
const CLAUSE_STARTERS = new Set(["for", "select", "case"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const MAX_DEPTH = 8;

interface Token {
  kind: "word" | "operator" | "redirect";
  word?: ShellWord;
  op?: RedirectOp;
  fd?: number | null;
  text?: string;
}

interface LexState {
  source: string;
  index: number;
  depth: number;
  nested: string[];
  complete: boolean;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isNameStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isNameChar(char: string): boolean {
  return isNameStart(char) || isDigit(char);
}

/** `NAME=value` before the program is an assignment, not argv. */
export function isAssignment(word: string): boolean {
  const equals = word.indexOf("=");
  if (equals <= 0) return false;
  const name = word.slice(0, equals);
  if (!isNameStart(name[0] ?? "")) return false;
  for (const char of name) if (!isNameChar(char)) return false;
  return true;
}

/** Reads `$( ... )` or `` ` ... ` `` content, honoring nested quotes and parentheses. */
function readSubstitution(state: LexState, closer: ")" | "`"): string {
  let depth = 1;
  let text = "";
  let quote: "'" | '"' | null = null;
  while (state.index < state.source.length) {
    const char = state.source[state.index] ?? "";
    state.index += 1;
    if (quote === "'") {
      if (char === "'") quote = null;
      text += char;
      continue;
    }
    if (char === "\\") {
      text += char + (state.source[state.index] ?? "");
      state.index += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      text += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      text += char;
      continue;
    }
    if (closer === "`" && char === "`") return text;
    if (closer === ")") {
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) return text;
      }
    }
    text += char;
  }
  state.complete = false;
  return text;
}

function readDollar(state: LexState, word: ShellWord): void {
  word.expands = true;
  const next = state.source[state.index + 1];
  if (next === "(" && state.source[state.index + 2] === "(") {
    state.index += 3;
    word.value += `$((${readSubstitution(state, ")")})`;
    if (state.source[state.index] === ")") state.index += 1;
    word.dynamic = true;
    return;
  }
  if (next === "(") {
    state.index += 2;
    state.nested.push(readSubstitution(state, ")"));
    word.value += "$(...)";
    word.dynamic = true;
    return;
  }
  word.value += "$";
  word.dynamic = true;
  state.index += 1;
}

function readWord(state: LexState): ShellWord {
  const word: ShellWord = { value: "", dynamic: false, expands: false, glob: false };
  let quote: "'" | '"' | null = null;
  const first = state.source[state.index];
  if (first === "~") {
    word.dynamic = true;
    word.expands = true;
  }
  while (state.index < state.source.length) {
    const char = state.source[state.index] ?? "";
    if (quote === "'") {
      state.index += 1;
      if (char === "'") quote = null;
      else word.value += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        state.index += 1;
      } else if (char === "\\") {
        const escaped = state.source[state.index + 1] ?? "";
        word.value += '$`"\\\n'.includes(escaped) ? escaped : `\\${escaped}`;
        state.index += 2;
      } else if (char === "$") readDollar(state, word);
      else if (char === "`") {
        state.index += 1;
        state.nested.push(readSubstitution(state, "`"));
        word.value += "`...`";
        word.dynamic = true;
        word.expands = true;
      } else {
        word.value += char;
        state.index += 1;
      }
      continue;
    }
    if (BLANKS.has(char) || OPERATOR_CHARS.has(char) || REDIRECT_CHARS.has(char)) break;
    if (char === "'" || char === '"') {
      quote = char;
      state.index += 1;
      continue;
    }
    if (char === "\\") {
      const escaped = state.source[state.index + 1];
      if (escaped !== "\n" && escaped !== undefined) word.value += escaped;
      state.index += 2;
      continue;
    }
    if (char === "$") {
      readDollar(state, word);
      continue;
    }
    if (char === "`") {
      state.index += 1;
      state.nested.push(readSubstitution(state, "`"));
      word.value += "`...`";
      word.dynamic = true;
      word.expands = true;
      continue;
    }
    if (GLOB_CHARS.has(char)) {
      word.dynamic = true;
      word.glob = true;
    }
    word.value += char;
    state.index += 1;
  }
  if (quote !== null) state.complete = false;
  return word;
}

function readRedirect(state: LexState, fd: number | null): Token {
  const source = state.source;
  const char = source[state.index] ?? "";
  const next = source[state.index + 1] ?? "";
  const third = source[state.index + 2] ?? "";
  let op: RedirectOp;
  if (char === "&") {
    op = third === ">" ? "&>>" : "&>";
  } else if (char === ">") {
    op = next === ">" ? ">>" : next === "&" ? ">&" : next === "|" ? ">|" : ">";
  } else {
    op =
      next === "<"
        ? third === "<"
          ? "<<<"
          : "<<"
        : next === "&"
          ? "<&"
          : next === ">"
            ? "<>"
            : "<";
  }
  state.index += op.length;
  return { kind: "redirect", op, fd };
}

function nextToken(state: LexState): Token | null {
  const source = state.source;
  while (state.index < source.length) {
    const char = source[state.index] ?? "";
    if (BLANKS.has(char)) {
      state.index += 1;
      continue;
    }
    if (char === "\\" && source[state.index + 1] === "\n") {
      state.index += 2;
      continue;
    }
    if (char === "#") {
      while (state.index < source.length && source[state.index] !== "\n") state.index += 1;
      continue;
    }
    break;
  }
  if (state.index >= source.length) return null;
  const char = source[state.index] ?? "";
  if (char === "&" && source[state.index + 1] === ">") return readRedirect(state, null);
  if (REDIRECT_CHARS.has(char)) return readRedirect(state, null);
  if (OPERATOR_CHARS.has(char)) {
    const pair = source.slice(state.index, state.index + 2);
    const text = pair === "&&" || pair === "||" || pair === ";;" || pair === "|&" ? pair : char;
    state.index += text.length;
    return { kind: "operator", text };
  }
  if (isDigit(char)) {
    let end = state.index;
    while (isDigit(source[end])) end += 1;
    if (REDIRECT_CHARS.has(source[end] ?? "")) {
      const fd = Number.parseInt(source.slice(state.index, end), 10);
      state.index = end;
      return readRedirect(state, fd);
    }
  }
  return { kind: "word", word: readWord(state) };
}

/** Skips here-document bodies: their lines are data for the command, not commands. */
function skipHeredocs(state: LexState, delimiters: { word: string; tabs: boolean }[]): void {
  for (const delimiter of delimiters) {
    let found = false;
    while (state.index < state.source.length) {
      const end = state.source.indexOf("\n", state.index);
      const stop = end < 0 ? state.source.length : end;
      let line = state.source.slice(state.index, stop);
      state.index = end < 0 ? stop : stop + 1;
      if (delimiter.tabs) while (line.startsWith("\t")) line = line.slice(1);
      if (line === delimiter.word) {
        found = true;
        break;
      }
    }
    if (!found) state.complete = false;
  }
  delimiters.length = 0;
}

function lex(
  source: string,
  depth: number,
): { tokens: Token[]; nested: string[]; complete: boolean } {
  const state: LexState = { source, index: 0, depth, nested: [], complete: true };
  const tokens: Token[] = [];
  const heredocs: { word: string; tabs: boolean }[] = [];
  for (let token = nextToken(state); token !== null; token = nextToken(state)) {
    const previous = tokens[tokens.length - 1];
    if (token.kind === "word" && previous?.kind === "redirect" && previous.op === "<<") {
      const raw = token.word?.value ?? "";
      const tabs = raw.startsWith("-");
      const word = tabs ? raw.slice(1) : raw;
      heredocs.push({ word, tabs });
      tokens.push({
        kind: "word",
        word: { value: word, dynamic: false, expands: false, glob: false },
      });
      continue;
    }
    tokens.push(token);
    if (token.kind === "operator" && token.text === "\n" && heredocs.length > 0) {
      skipHeredocs(state, heredocs);
    }
  }
  if (heredocs.length > 0) state.complete = false;
  return { tokens, nested: state.nested, complete: state.complete };
}

function finishCommand(current: SimpleCommand, out: SimpleCommand[], depth: number): void {
  const first = current.argv[0]?.value;
  if (first !== undefined && CLAUSE_STARTERS.has(first)) return;
  while (current.argv.length > 0 && RESERVED.has(current.argv[0]?.value ?? ""))
    current.argv.shift();
  if (current.argv.length === 0 && current.redirects.length === 0) return;
  out.push(current);
  const program = current.argv[0]?.value ?? "";
  const name = program.slice(program.lastIndexOf("/") + 1);
  if (!SHELLS.has(name)) return;
  const flag = current.argv.findIndex((word) => word.value === "-c" || word.value === "-lc");
  const script = flag >= 0 ? current.argv[flag + 1] : undefined;
  if (script !== undefined) out.push(...parseAt(script.value, depth + 1).commands);
}

function parseAt(source: string, depth: number): ShellParse {
  if (depth > MAX_DEPTH) return { commands: [], complete: false };
  const { tokens, nested, complete } = lex(source, depth);
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { argv: [], assignments: [], redirects: [] };
  let ok = complete;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.kind === "operator") {
      finishCommand(current, commands, depth);
      current = { argv: [], assignments: [], redirects: [] };
      continue;
    }
    if (token.kind === "redirect") {
      const target = tokens[index + 1];
      if (target?.kind === "word" && target.word) {
        current.redirects.push({
          op: token.op ?? ">",
          fd: token.fd ?? null,
          target: target.word.value,
        });
        index += 1;
      } else ok = false;
      continue;
    }
    const word = token.word;
    if (!word) continue;
    if (current.argv.length === 0 && isAssignment(word.value)) {
      current.assignments.push(word.value);
      continue;
    }
    current.argv.push(word);
  }
  finishCommand(current, commands, depth);
  for (const inner of nested) {
    const parsed = parseAt(inner, depth + 1);
    commands.push(...parsed.commands);
    if (!parsed.complete) ok = false;
  }
  return { commands, complete: ok };
}

/** Splits a shell line into the simple commands it would run. */
export function parseShell(source: string): ShellParse {
  return parseAt(source, 0);
}

/** Lowercased basename of a program word: `/usr/bin/RM.exe` becomes `rm`. */
export function programName(word: string): string {
  const slashed = word.split("\\").join("/");
  const name = slashed.slice(slashed.lastIndexOf("/") + 1).toLowerCase();
  return name.endsWith(".exe") ? name.slice(0, -4) : name;
}
