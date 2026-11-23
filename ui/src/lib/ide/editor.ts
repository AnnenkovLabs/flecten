import type { editor } from "monaco-editor";
import { t } from "../i18n.svelte";

export interface EditorLanguageInfo {
  id: string;
  label: string;
}

export interface FileIconInfo {
  color: string;
  badge: string;
}

export interface EditorPreferences {
  wrap: boolean;
  tabSize: number;
  fontSize: number;
  minimap?: boolean;
}

const SPECIAL_NAMES: Record<string, EditorLanguageInfo> = {
  dockerfile: { id: "dockerfile", label: "Dockerfile" },
  makefile: { id: "shell", label: "Makefile" },
  ".gitignore": { id: "ini", label: "Git Ignore" },
  ".dockerignore": { id: "ini", label: "Docker Ignore" },
  ".editorconfig": { id: "ini", label: "EditorConfig" },
  ".env": { id: "ini", label: "Env" },
  ".bashrc": { id: "shell", label: "Shell" },
  ".zshrc": { id: "shell", label: "Shell" },
  ".profile": { id: "shell", label: "Shell" },
  "tsconfig.json": { id: "json", label: "JSONC" },
  "jsconfig.json": { id: "json", label: "JSONC" },
};

const EXTENSIONS: Record<string, EditorLanguageInfo> = {
  ts: { id: "typescript", label: "TypeScript" },
  mts: { id: "typescript", label: "TypeScript" },
  cts: { id: "typescript", label: "TypeScript" },
  tsx: { id: "typescript", label: "TypeScript JSX" },
  js: { id: "javascript", label: "JavaScript" },
  mjs: { id: "javascript", label: "JavaScript" },
  cjs: { id: "javascript", label: "JavaScript" },
  jsx: { id: "javascript", label: "JavaScript JSX" },
  json: { id: "json", label: "JSON" },
  jsonc: { id: "json", label: "JSONC" },
  css: { id: "css", label: "CSS" },
  scss: { id: "scss", label: "SCSS" },
  less: { id: "less", label: "Less" },
  html: { id: "html", label: "HTML" },
  htm: { id: "html", label: "HTML" },
  svelte: { id: "html", label: "Svelte" },
  vue: { id: "html", label: "Vue" },
  xml: { id: "xml", label: "XML" },
  svg: { id: "xml", label: "SVG" },
  md: { id: "markdown", label: "Markdown" },
  markdown: { id: "markdown", label: "Markdown" },
  mdx: { id: "mdx", label: "MDX" },
  py: { id: "python", label: "Python" },
  pyi: { id: "python", label: "Python" },
  rs: { id: "rust", label: "Rust" },
  go: { id: "go", label: "Go" },
  c: { id: "c", label: "C" },
  h: { id: "c", label: "C Header" },
  cpp: { id: "cpp", label: "C++" },
  cc: { id: "cpp", label: "C++" },
  cxx: { id: "cpp", label: "C++" },
  hpp: { id: "cpp", label: "C++ Header" },
  cs: { id: "csharp", label: "C#" },
  java: { id: "java", label: "Java" },
  kt: { id: "kotlin", label: "Kotlin" },
  kts: { id: "kotlin", label: "Kotlin" },
  swift: { id: "swift", label: "Swift" },
  rb: { id: "ruby", label: "Ruby" },
  php: { id: "php", label: "PHP" },
  lua: { id: "lua", label: "Lua" },
  sh: { id: "shell", label: "Shell" },
  bash: { id: "shell", label: "Bash" },
  zsh: { id: "shell", label: "Zsh" },
  ps1: { id: "powershell", label: "PowerShell" },
  bat: { id: "bat", label: "Batch" },
  cmd: { id: "bat", label: "Batch" },
  yml: { id: "yaml", label: "YAML" },
  yaml: { id: "yaml", label: "YAML" },
  toml: { id: "ini", label: "TOML" },
  ini: { id: "ini", label: "INI" },
  conf: { id: "ini", label: "Config" },
  sql: { id: "sql", label: "SQL" },
  graphql: { id: "graphql", label: "GraphQL" },
  gql: { id: "graphql", label: "GraphQL" },
  proto: { id: "protobuf", label: "Protobuf" },
  tf: { id: "hcl", label: "Terraform" },
  hcl: { id: "hcl", label: "HCL" },
  dart: { id: "dart", label: "Dart" },
  ex: { id: "elixir", label: "Elixir" },
  exs: { id: "elixir", label: "Elixir" },
  scala: { id: "scala", label: "Scala" },
  r: { id: "r", label: "R" },
  wgsl: { id: "wgsl", label: "WGSL" },
  frag: { id: "cpp", label: "GLSL" },
  vert: { id: "cpp", label: "GLSL" },
  glsl: { id: "cpp", label: "GLSL" },
  sol: { id: "sol", label: "Solidity" },
};

function fileNameAndSuffix(path: string): { name: string; suffix: string } {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = path.slice(slash + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  const suffix = dot > 0 ? name.slice(dot + 1) : "";
  return { name, suffix };
}

/** Filename extensions select a Monaco language explicitly; unknown formats remain plain text. */
export function editorLanguage(path: string): EditorLanguageInfo {
  const { name, suffix } = fileNameAndSuffix(path);
  if (SPECIAL_NAMES[name]) return SPECIAL_NAMES[name];
  if (name.startsWith(".env.")) return { id: "ini", label: "Env" };
  if (name.startsWith("dockerfile.")) return { id: "dockerfile", label: "Dockerfile" };
  if (suffix && EXTENSIONS[suffix]) return EXTENSIONS[suffix];
  return { id: "plaintext", label: t("Text") };
}

const ICON_COLORS: Record<string, FileIconInfo> = {
  ts: { color: "#79aee6", badge: "TS" },
  mts: { color: "#79aee6", badge: "TS" },
  cts: { color: "#79aee6", badge: "TS" },
  tsx: { color: "#85c1eb", badge: "TX" },
  js: { color: "#e4d19c", badge: "JS" },
  mjs: { color: "#e4d19c", badge: "JS" },
  cjs: { color: "#e4d19c", badge: "JS" },
  jsx: { color: "#e4d19c", badge: "JX" },
  svelte: { color: "#e09a7d", badge: "SV" },
  vue: { color: "#83cbb8", badge: "VU" },
  html: { color: "#dba489", badge: "HT" },
  htm: { color: "#dba489", badge: "HT" },
  css: { color: "#98b9e8", badge: "CS" },
  scss: { color: "#d596b4", badge: "SC" },
  less: { color: "#98b9e8", badge: "LS" },
  json: { color: "#dcc58f", badge: "{}" },
  jsonc: { color: "#dcc58f", badge: "{}" },
  md: { color: "#b7a1e8", badge: "MD" },
  markdown: { color: "#b7a1e8", badge: "MD" },
  mdx: { color: "#b7a1e8", badge: "MD" },
  py: { color: "#93b9dc", badge: "PY" },
  rs: { color: "#d99e82", badge: "RS" },
  go: { color: "#83cbb8", badge: "GO" },
  sh: { color: "#a6c19f", badge: "SH" },
  bash: { color: "#a6c19f", badge: "SH" },
  zsh: { color: "#a6c19f", badge: "SH" },
  yml: { color: "#c5aef2", badge: "YM" },
  yaml: { color: "#c5aef2", badge: "YM" },
  toml: { color: "#b5b3b0", badge: "TM" },
  sql: { color: "#a4cbe8", badge: "SQ" },
  svg: { color: "#e4d19c", badge: "SV" },
  frag: { color: "#b7a1e8", badge: "GL" },
  vert: { color: "#b7a1e8", badge: "GL" },
};

/** Subtle language tint for file tabs, explorer rows, and breadcrumbs. */
export function fileIcon(path: string): FileIconInfo {
  const { name, suffix } = fileNameAndSuffix(path);
  if (name === "dockerfile" || name.startsWith("dockerfile.")) {
    return { color: "#85b7e0", badge: "DK" };
  }
  if (name === ".gitignore" || name === ".gitattributes") {
    return { color: "#dba489", badge: "GT" };
  }
  if (suffix && ICON_COLORS[suffix]) return ICON_COLORS[suffix];
  return { color: "var(--muted)", badge: "" };
}

export function detectEol(text: string): "CRLF" | "LF" {
  return text.includes("\r\n") ? "CRLF" : "LF";
}

export function monacoEditorOptions(
  preferences: EditorPreferences,
  readOnly: boolean,
  reducedMotion: boolean,
  showMinimap: boolean,
  ariaLabel: string,
): editor.IStandaloneEditorConstructionOptions {
  const lineHeight = Math.round(preferences.fontSize * 1.62);
  return {
    ariaLabel,
    readOnly,
    domReadOnly: readOnly,
    tabSize: preferences.tabSize,
    insertSpaces: true,
    detectIndentation: false,
    wordWrap: preferences.wrap ? "on" : "off",
    fontSize: preferences.fontSize,
    lineHeight,
    fontFamily:
      'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", "Roboto Mono", monospace',
    fontLigatures: true,
    letterSpacing: 0,
    cursorStyle: "line",
    cursorWidth: 2,
    cursorBlinking: reducedMotion ? "solid" : "smooth",
    cursorSmoothCaretAnimation: reducedMotion ? "off" : "explicit",
    smoothScrolling: !reducedMotion,
    scrollBeyondLastLine: true,
    scrollBeyondLastColumn: 4,
    roundedSelection: true,
    renderLineHighlight: "all",
    renderLineHighlightOnlyWhenFocus: false,
    renderWhitespace: "selection",
    renderControlCharacters: false,
    showFoldingControls: "mouseover",
    folding: true,
    foldingHighlight: true,
    foldingStrategy: "auto",
    bracketPairColorization: {
      enabled: true,
      independentColorPoolPerBracketType: true,
    },
    guides: {
      indentation: true,
      highlightActiveIndentation: true,
      bracketPairs: "active",
      bracketPairsHorizontal: "active",
    },
    matchBrackets: "always",
    occurrencesHighlight: "singleFile",
    occurrencesHighlightDelay: 120,
    selectionHighlight: true,
    multiCursorModifier: "alt",
    emptySelectionClipboard: true,
    dragAndDrop: true,
    links: true,
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    autoSurround: "languageDefined",
    autoClosingDelete: "auto",
    autoClosingOvertype: "auto",
    autoIndent: "full",
    formatOnPaste: false,
    formatOnType: false,
    minimap: {
      enabled: showMinimap && (preferences.minimap ?? true),
      renderCharacters: false,
      maxColumn: 80,
      showSlider: "mouseover",
      side: "right",
      scale: 1,
    },
    stickyScroll: {
      enabled: true,
      maxLineCount: 4,
    },
    lineNumbers: "on",
    lineNumbersMinChars: 4,
    glyphMargin: false,
    lineDecorationsWidth: 12,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: false,
    padding: { top: 10, bottom: 16 },
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: true,
      verticalHasArrows: false,
      horizontalHasArrows: false,
      alwaysConsumeMouseWheel: false,
    },
    find: {
      addExtraSpaceOnTop: true,
      autoFindInSelection: "multiline",
      seedSearchStringFromSelection: "selection",
    },
    // Keep the editing experience quiet and distraction-free: no popup noise.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: "off",
    parameterHints: { enabled: false },
    hover: { enabled: "off" },
    codeLens: false,
    inlineSuggest: { enabled: false },
    lightbulb: { enabled: "off" as editor.ShowLightbulbIconMode },
    contextmenu: true,
    copyWithSyntaxHighlighting: false,
    editContext: false,
    automaticLayout: false,
    fixedOverflowWidgets: true,
  };
}
