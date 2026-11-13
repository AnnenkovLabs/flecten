/** Reactive Svelte proxies must become plain protocol data before crossing the frame boundary. */
export function moduleTransfer(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
