/** Chromium treats ordinary typing on a clicked button as keyboard navigation. */
export function installFocusNavigation(document: Document): () => void {
  const root = document.documentElement;
  const pointer = (): void => {
    root.dataset.focusNavigation = "pointer";
  };
  const keyboard = (event: KeyboardEvent): void => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Tab") root.dataset.focusNavigation = "keyboard";
    else if (
      event.defaultPrevented &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      // Roving controls prevent the default when they actually handle navigation.
      root.dataset.focusNavigation = "keyboard";
    }
  };

  pointer();
  document.addEventListener("pointerdown", pointer, true);
  // Capture Tab before focus moves; bubbling observes navigation handled by controls.
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("keydown", keyboard);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("keydown", keyboard);
    delete root.dataset.focusNavigation;
  };
}
