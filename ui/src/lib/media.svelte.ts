class ReducedMotion {
  current = $state(false);
  #query: MediaQueryList | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    this.#query = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.current = this.#query.matches;
    this.#query.addEventListener("change", (event) => {
      this.current = event.matches;
    });
  }
}

export const reducedMotion = new ReducedMotion();
