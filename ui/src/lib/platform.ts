function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

export const modLabel = isMac() ? "⌘" : "Ctrl";

export function isModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function shortcutLabel(key: string): string {
  return isMac() ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}
