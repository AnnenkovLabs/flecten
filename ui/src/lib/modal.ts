/** Native dialogs own focus trapping and restoration; every surface shares their lifecycle. */
export function modal(
  node: HTMLDialogElement,
  initialFocus?: () => HTMLElement | null | undefined,
): { destroy: () => void } {
  const opener = document.activeElement;
  if (!node.open) node.showModal();
  if (initialFocus)
    queueMicrotask(() => {
      if (node.open) initialFocus()?.focus();
    });
  return {
    destroy: () => {
      if (node.open) node.close();
      // Svelte can detach the dialog before cleanup, so native restoration alone is insufficient.
      queueMicrotask(() => {
        if (opener instanceof HTMLElement && opener.isConnected)
          opener.focus({ preventScroll: true });
      });
    },
  };
}
