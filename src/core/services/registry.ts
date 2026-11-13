import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

export type ServiceFunction = (...args: never[]) => unknown;
export interface ServiceContract<T extends ServiceFunction> {
  readonly id: string;
  readonly signature: string;
  readonly guard: (handler: T) => T;
}
export function serviceContract<T extends ServiceFunction>(id: string): ServiceContract<T> {
  return { id, signature: id, guard: (handler) => handler };
}
/** User-defined services carry their own schemas, independent of product concepts. */
export function defineService<I, O>(id: string, input: z.ZodType<I>, output: z.ZodType<O>) {
  return {
    id: z.string().min(1).max(200).parse(id),
    signature: JSON.stringify([z.toJSONSchema(input), z.toJSONSchema(output)]),
    guard:
      (handler: (input: I, signal: AbortSignal) => Promise<O>) =>
      async (value: I, signal: AbortSignal) =>
        output.parse(await handler(input.parse(value), signal)),
  } satisfies ServiceContract<(input: I, signal: AbortSignal) => Promise<O>>;
}
interface Invocation {
  readonly layers: readonly ServiceLayer[];
  readonly scope: string | undefined;
  readonly parent: Invocation | undefined;
  active: boolean;
}
const invocations = new AsyncLocalStorage<Map<object, Invocation>>();
function inheritedInvocation(context: object, scope: string | undefined): Invocation | undefined {
  let invocation = invocations.getStore()?.get(context);
  while (invocation) {
    if (invocation.active && (scope === undefined || invocation.scope === scope)) return invocation;
    invocation = invocation.parent;
  }
  return undefined;
}
interface ContractIdentity {
  readonly id: string;
  readonly signature: string;
}
interface Registration {
  contract: ContractIdentity;
  mode: "provide" | "replace" | "wrap";
  apply(previous: ServiceFunction | undefined): ServiceFunction;
}
export class ServiceLayer {
  readonly registrations: Registration[] = [];
  readonly requirements = new Map<string, string>();
  #users = 0;
  #retired = false;
  #finished: Promise<void> | undefined;
  #sealed = false;
  seal(): void {
    this.#sealed = true;
  }
  constructor(
    readonly owner: string,
    readonly cleanup: () => Promise<void>,
    readonly report?: (error: unknown) => void,
  ) {}
  provide<T extends ServiceFunction>(contract: ServiceContract<T>, handler: T): void {
    this.#add(contract, "provide", () => contract.guard(handler));
  }
  replace<T extends ServiceFunction>(contract: ServiceContract<T>, handler: T): void {
    this.#add(contract, "replace", () => contract.guard(handler));
  }
  wrap<T extends ServiceFunction>(contract: ServiceContract<T>, wrap: (next: T) => T): void {
    this.#add(contract, "wrap", (previous) => {
      if (!previous) throw new Error(`Missing service ${contract.id} required by ${this.owner}`);
      return contract.guard(wrap(previous));
    });
  }
  #add<T extends ServiceFunction>(
    contract: ServiceContract<T>,
    mode: Registration["mode"],
    apply: (previous: T | undefined) => T,
  ): void {
    if (this.#retired || this.#sealed)
      throw new Error(`Service owner ${this.owner} no longer accepts registrations`);
    this.registrations.push({ contract, mode, apply: apply as unknown as Registration["apply"] });
  }
  acquire(pinned = false): () => void {
    if (this.#retired && (!pinned || this.#users === 0))
      throw new Error(`Service owner ${this.owner} was unloaded`);
    this.#users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#retired && !this.#users) void this.retire();
    };
  }
  retire(): Promise<void> {
    this.#retired = true;
    if (this.#users) return Promise.resolve();
    this.#finished ??= this.cleanup().catch((error: unknown) => this.report?.(error));
    return this.#finished;
  }
}

/** A call snapshots its composition; reload affects the next call, including streams. */
export class Services {
  constructor(
    readonly layers: () => readonly ServiceLayer[],
    readonly context: object = {},
    readonly scope?: string,
  ) {}
  has(contract: ContractIdentity): boolean {
    return (inheritedInvocation(this.context, this.scope)?.layers ?? this.layers()).some((layer) =>
      layer.registrations.some((r) => r.contract.id === contract.id),
    );
  }
  inspect() {
    return this.layers().flatMap((layer) =>
      layer.registrations.map((r) => ({
        owner: layer.owner,
        service: r.contract.id,
        mode: r.mode,
      })),
    );
  }
  validate(defaults: readonly ContractIdentity[] = []): void {
    const contracts = new Map(defaults.map((c) => [c.id, c.signature]));
    const supplied = new Set(contracts.keys());
    for (const layer of this.layers())
      for (const r of layer.registrations) {
        const signature = contracts.get(r.contract.id);
        if (signature && signature !== r.contract.signature)
          throw new Error(`Incompatible service contract ${r.contract.id}`);
        if (r.mode === "provide" && supplied.has(r.contract.id))
          throw new Error(`Duplicate service ${r.contract.id}; use replace explicitly`);
        if (r.mode === "wrap" && !supplied.has(r.contract.id))
          throw new Error(`Missing service ${r.contract.id}`);
        contracts.set(r.contract.id, r.contract.signature);
        supplied.add(r.contract.id);
      }
    for (const layer of this.layers())
      for (const [id, signature] of layer.requirements) {
        if (contracts.get(id) !== signature)
          throw new Error(`Missing or incompatible service ${id} required by ${layer.owner}`);
      }
  }
  async invoke<T extends ServiceFunction>(
    contract: ServiceContract<T>,
    fallback: T | undefined,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    const inherited = inheritedInvocation(this.context, this.scope);
    const layers = inherited?.layers ?? this.layers();
    const release = layers.map((layer) => layer.acquire(inherited !== undefined));
    const invocation: Invocation = {
      layers,
      scope: this.scope,
      active: true,
      parent: invocations.getStore()?.get(this.context),
    };
    const finish = () => {
      if (!invocation.active) return;
      invocation.active = false;
      for (const done of release.reverse()) done();
    };
    const snapshot = new Map(invocations.getStore()).set(this.context, invocation);
    const within = <R>(run: () => R): R => invocations.run(snapshot, run);
    let leased = false;
    try {
      let handler: ServiceFunction | undefined = fallback;
      for (const layer of layers)
        for (const r of layer.registrations)
          if (r.contract.id === contract.id) {
            if (r.contract.signature !== contract.signature)
              throw new Error(`Incompatible service contract ${contract.id}`);
            handler = r.apply(handler);
          }
      if (!handler) throw new Error(`Missing service ${contract.id}`);
      const result = await within(() => (handler as T)(...args));
      if (result && typeof result === "object" && Symbol.asyncIterator in result) {
        const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        leased = true;
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          async next() {
            try {
              const item = await within(() => iterator.next());
              if (item.done) finish();
              return item;
            } catch (error) {
              finish();
              throw error;
            }
          },
          async return() {
            try {
              return (await within(() => iterator.return?.())) ?? { done: true, value: undefined };
            } finally {
              finish();
            }
          },
          async throw(error: unknown) {
            try {
              if (iterator.throw) return await within(() => iterator.throw?.(error));
              throw error;
            } finally {
              finish();
            }
          },
        } as Awaited<ReturnType<T>>;
      }
      return result as Awaited<ReturnType<T>>;
    } finally {
      if (!leased) finish();
    }
  }
}
