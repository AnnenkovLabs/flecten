import type { TwinPowerVisual } from "./power";

export const twinPowerContext = Symbol("twin-power");
export type TwinPowerSource = () => TwinPowerVisual;
