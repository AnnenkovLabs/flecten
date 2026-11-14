import { join } from "node:path";
import { productEnv } from "../../shared/environment.cjs";

export function profilePath(explicitPath?: string): string | undefined {
  if (explicitPath || productEnv("CONFIG")?.trim()) return undefined;
  const directory = productEnv("PROFILE")?.trim();
  return directory ? join(directory, "flecten.config.json") : undefined;
}
