import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { FLECTEN_THEME, flectenDarkTheme } from "./editor-theme";

let initialized = false;

const QUIET_MODE = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  diagnostics: false,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
  colors: false,
  foldingRanges: false,
  selectionRanges: false,
  documentFormattingEdits: false,
};

/**
 * Configure Monaco once in the renderer:
 * - Use the lightweight core editor worker (no heavy TS/CSS/HTML LSP workers)
 * - Keep JSON tokenization active while disabling noisy diagnostic squiggles/popups
 * - Register and activate the Flecten Dark theme
 */
export function initMonaco(): typeof monaco {
  if (initialized) return monaco;
  initialized = true;

  globalThis.MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };

  monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
  monaco.typescript.typescriptDefaults.setModeConfiguration(QUIET_MODE);
  monaco.typescript.javascriptDefaults.setModeConfiguration(QUIET_MODE);
  monaco.css.cssDefaults.setOptions({ validate: false });
  monaco.css.scssDefaults.setOptions({ validate: false });
  monaco.css.lessDefaults.setOptions({ validate: false });
  monaco.css.cssDefaults.setModeConfiguration(QUIET_MODE);
  monaco.css.scssDefaults.setModeConfiguration(QUIET_MODE);
  monaco.css.lessDefaults.setModeConfiguration(QUIET_MODE);
  monaco.html.htmlDefaults.setModeConfiguration(QUIET_MODE);
  monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
  monaco.json.jsonDefaults.setModeConfiguration({
    ...QUIET_MODE,
    tokens: true,
  });

  monaco.editor.defineTheme(FLECTEN_THEME, flectenDarkTheme);
  monaco.editor.setTheme(FLECTEN_THEME);
  return monaco;
}
