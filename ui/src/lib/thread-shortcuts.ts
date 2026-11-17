/** Focused controls own search; workspace tabs supply the owner when focus is in chrome. */
export function ownsThreadShortcut(scroller: HTMLElement): boolean {
  if (!scroller.checkVisibility()) return false;
  const focused = document.activeElement;
  const pane = focused?.closest('[role="tabpanel"]');
  if (pane) return pane.contains(scroller);
  const tab =
    focused?.closest('[role="tab"]') ??
    scroller.closest(".task-workspace")?.querySelector('[role="tab"][aria-selected="true"]');
  const paneId = tab?.getAttribute("aria-controls");
  return !paneId || scroller.closest('[role="tabpanel"]')?.id === paneId;
}
