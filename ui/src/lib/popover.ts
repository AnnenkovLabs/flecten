interface Bounds {
  left: number;
  top: number;
  bottom: number;
}

/** Place a menu in the visible viewport, choosing the side with enough room. */
export function popoverPlacement(
  anchor: Bounds,
  viewport: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
  preferred: "above" | "below" = "above",
): { left: number; top: number; width: number; maxHeight: number } {
  const margin = 8;
  const leftEdge = viewport.left + margin;
  const topEdge = viewport.top + margin;
  const rightEdge = viewport.left + viewport.width - margin;
  const bottomEdge = viewport.top + viewport.height - margin;
  const above = Math.max(0, anchor.top - topEdge - margin);
  const below = Math.max(0, bottomEdge - anchor.bottom - margin);
  const opensAbove =
    preferred === "above"
      ? above >= height || above >= below
      : !(below >= height || below >= above);
  const maxHeight = Math.min(
    height,
    opensAbove ? above : below,
    Math.max(0, viewport.height - margin * 2),
  );
  const menuWidth = Math.min(width, Math.max(0, rightEdge - leftEdge));
  return {
    width: menuWidth,
    maxHeight,
    left: Math.max(leftEdge, Math.min(anchor.left, rightEdge - menuWidth)),
    top: Math.max(
      topEdge,
      Math.min(
        opensAbove ? anchor.top - margin - maxHeight : anchor.bottom + margin,
        bottomEdge - maxHeight,
      ),
    ),
  };
}
