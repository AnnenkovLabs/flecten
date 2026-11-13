import type { UsagePrice } from "./session/budget";
import type { ImagePart, Usage } from "./types";

export interface VisionUsage {
  usage: Usage;
  provider: string;
  model: string;
  price: UsagePrice;
  durationMs: number;
}

export interface VisionOptions {
  describe(
    image: ImagePart,
    focus: string | undefined,
    signal: AbortSignal,
    onUsage: (value: VisionUsage) => void,
  ): Promise<string>;
}

export type InspectImage = (
  image: ImagePart,
  focus: string | undefined,
  signal: AbortSignal,
) => Promise<string>;
