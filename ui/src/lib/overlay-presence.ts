import { prefersReducedMotion } from "./motion";

/** Keep a conditional overlay mounted while its CSS leaves the native top layer. */
export function overlayPresence(node: HTMLElement) {
  return (options?: { direction: "in" | "out" }) => {
    if (options?.direction !== "out") {
      if (node instanceof HTMLDialogElement) {
        if (!node.open) node.showModal();
      } else if (!node.matches(":popover-open")) {
        node.showPopover();
      }
      return { duration: 0 };
    }

    if (node instanceof HTMLDialogElement) {
      if (node.open) node.close();
    } else if (node.matches(":popover-open")) {
      node.hidePopover();
    }
    return {
      duration: prefersReducedMotion()
        ? 0
        : Number(getComputedStyle(node).getPropertyValue("--overlay-exit-ms")),
    };
  };
}
