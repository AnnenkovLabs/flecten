import type { TwinSnapshot } from "../../shared/twin";

/** A rejected or interrupted response can still be billed by the provider. */
export class TwinInferenceError extends Error {
  constructor(
    cause: unknown,
    readonly usage: TwinSnapshot["training"]["usage"],
    readonly provider: string,
    readonly model: string,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "TwinInferenceError";
  }
}
