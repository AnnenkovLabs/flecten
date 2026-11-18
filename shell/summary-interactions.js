const createSummaryInteractions = (root) => {
  let generation;
  let deliveryMode;
  let sendInteraction;

  // Accept only DOM events observed inside this artifact during a user gesture.
  const gestures = new WeakMap();
  const observe = gestures.set.bind(gestures);
  const observed = gestures.get.bind(gestures);
  const phase = Function.call.bind(Object.getOwnPropertyDescriptor(Event.prototype, "eventPhase").get);
  const activation = navigator.userActivation;
  const active = activation && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(activation), "isActive")?.get?.bind(activation);
  for (const name of ["click", "change", "submit", "pointerup"]) {
    root.addEventListener(name, (event) => {
      if (sendInteraction && generation !== undefined && event.isTrusted && active?.()) {
        observe(event, { capture: false, trigger: false });
      }
    }, true);
  }
  const useGesture = (event, kind) => {
    const state = observed(event);
    if (!state || state[kind] || !event.isTrusted || phase(event) === 0) return false;
    state[kind] = true;
    return true;
  };
  const isInteger = Number.isInteger;
  const isFiniteNumber = Number.isFinite;
  const postInteraction = (interaction) => sendInteraction?.({ generation, interaction });

  Object.defineProperty(globalThis, "flectenSummary", {
    value: Object.freeze({
      deliver(options) {
        if (!options || typeof options !== "object") return;
        const { when, delayMs } = options;
        if (generation === undefined || deliveryMode || !sendInteraction) return;
        let delivery;
        if (when === "next-message" || when === "on-action") {
          delivery = { when };
        } else if (when === "after-delay" || when === "after-first-interaction") {
          if (!isInteger(delayMs) || delayMs < 1 || delayMs > 3_600_000) return;
          delivery = { when, delayMs };
        } else return;
        deliveryMode = when;
        postInteraction({ kind: "configure", delivery });
      },
      capture(event, name, value = null) {
        if (generation === undefined || !deliveryMode) return;
        if (typeof name !== "string" || name.length === 0 || name.length > 64) return;
        if (value !== null && typeof value !== "boolean" && !isFiniteNumber(value) &&
          !(typeof value === "string" && value.length <= 256)) return;
        if (useGesture(event, "capture")) postInteraction({ kind: "capture", name, value });
      },
      flush(event) {
        if (generation !== undefined && deliveryMode === "on-action" && useGesture(event, "trigger")) {
          postInteraction({ kind: "trigger" });
        }
      },
    }),
  });

  return {
    attach(port) {
      if (port && !sendInteraction) sendInteraction = port.postMessage.bind(port);
    },
    start(nextGeneration) {
      if (Number.isSafeInteger(nextGeneration)) generation = nextGeneration;
    },
    reset() {
      generation = undefined;
      deliveryMode = undefined;
    },
  };
};
