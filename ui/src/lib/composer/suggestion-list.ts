import { tick } from "svelte";

interface SuggestionListOptions {
  count: number;
  active: number;
  onMove: (index: number) => void;
  onSelect: (index: number) => void;
  onClose: () => void;
}

/** Keep focus in the prompt while navigating either command or context suggestions. */
export function suggestionList(node: HTMLElement, initial: SuggestionListOptions) {
  let options = initial;

  function keydown(event: KeyboardEvent): void {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const { active, count, onMove, onSelect, onClose } = options;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (count === 0) return;
      const next = Math.max(0, Math.min(active + (event.key === "ArrowDown" ? 1 : -1), count - 1));
      onMove(next);
      void tick().then(() => {
        node
          .querySelectorAll<HTMLElement>('[role="option"]')
          [next]?.scrollIntoView({ block: "nearest" });
      });
    } else if (event.key === "Enter" && count > 0) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(active);
    }
  }

  window.addEventListener("keydown", keydown, true);
  return {
    update(next: SuggestionListOptions) {
      options = next;
    },
    destroy() {
      window.removeEventListener("keydown", keydown, true);
    },
  };
}
