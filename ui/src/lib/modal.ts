/** Native dialogs own focus trapping and restoration; every surface shares their lifecycle. */
export function modal(
  node: HTMLDialogElement,
  initialFocus?: () => HTMLElement | null | undefined,
): { destroy: () => void } {
  const opener = document.activeElement;
  function focusOnOpen(event: ToggleEvent): void {
    if (!initialFocus || event.newState !== "open") return;
    queueMicrotask(() => {
      if (node.open) initialFocus?.()?.focus({ preventScroll: true });
    });
  }
  node.addEventListener("beforetoggle", focusOnOpen);
  if (!node.open) node.showModal();
  return {
    destroy: () => {
      node.removeEventListener("beforetoggle", focusOnOpen);
      if (node.open) node.close();
      // Svelte can detach the dialog before cleanup, so native restoration alone is insufficient.
      queueMicrotask(() => {
        if (
          document.activeElement === document.body &&
          opener instanceof HTMLElement &&
          opener.isConnected
        )
          opener.focus({ preventScroll: true });
      });
    },
  };
}
