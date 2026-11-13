export const HARNESS_TOKENS = {
  "--bg": "#171717",
  "--surface": "#1b1b1b",
  "--raised": "#242424",
  "--text": "#f0efed",
  "--text-body": "rgba(240, 239, 237, 0.82)",
  "--text-2": "#b5b3b0",
  "--muted": "#999693",
  "--line": "rgba(240, 239, 237, 0.07)",
  "--line-strong": "rgba(240, 239, 237, 0.12)",
  "--raised-hover": "#303030",
  "--primary": "#b7a1e8",
  "--primary-end": "#a48dd3",
  "--primary-hover": "#c8b5f1",
  "--on-primary": "#1b1422",
  "--success": "#b2b9af",
  "--warning": "#d3bd91",
  "--error": "#e2a2a2",
  "--add": "#a6c19f",
  "--del": "#d8a3a3",
  "--font": '"Manrope", system-ui, -apple-system, "Segoe UI", sans-serif',
  "--mono": 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", monospace',
  "--space-1": "4px",
  "--space-2": "8px",
  "--space-3": "12px",
  "--space-4": "16px",
  "--space-6": "24px",
  "--ease": "cubic-bezier(0.2, 0.8, 0.2, 1)",
  "--ease-jelly": "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

export function fallbackToken(name: string): string {
  return (HARNESS_TOKENS as Record<string, string>)[name] ?? "";
}
