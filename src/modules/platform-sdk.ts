import type { z } from "zod";
import type { harnessServices } from "../core/services/contracts";
import type {
  defineService,
  ServiceContract,
  ServiceFunction,
  ServiceLayer,
} from "../core/services/registry";

/** Trusted platform code runs in the sidecar and can replace host mechanisms. */
export interface ModulePlatformHost {
  apiVersion: 1;
  workspace: string;
  moduleRoot: string;
  sessionId: string | undefined;
  signal: AbortSignal;
  z: typeof z;
  contracts: typeof harnessServices;
  defineService: typeof defineService;
  services: Pick<ServiceLayer, "provide" | "replace" | "wrap"> & {
    require<T extends ServiceFunction>(
      contract: ServiceContract<T>,
    ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;
  };
  effect(
    setup: () => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>,
  ): Promise<void>;
}
export type ModulePlatformSetup = (host: ModulePlatformHost) => void | Promise<void>;
