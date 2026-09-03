/**
 * Server-side energy accounting.
 *
 * The client tells us how long it hashed and on what class of device; the server
 * — never the client — turns that into kWh. This is the number the Guardian
 * token audits, so it is recomputed here on every submit and is never accepted
 * from the request body.
 */

import { ApiError } from "./http.ts";
import { formatKwh } from "./canonical.ts";

export const DEVICE_WATTS = {
  phone: 3,
  tablet: 5,
  laptop: 15,
  desktop: 45,
} as const;

export type DeviceClass = keyof typeof DEVICE_WATTS;

/** Solve time is clamped to [0, 30 s] before it can bill any energy. */
export const MAX_BILLABLE_MS = 30_000;

export function parseDeviceClass(value: unknown): DeviceClass {
  if (typeof value === "string" && value in DEVICE_WATTS) return value as DeviceClass;
  throw new ApiError("bad_request", `Field "deviceClass" must be one of ${Object.keys(DEVICE_WATTS).join(", ")}`, {
    field: "deviceClass",
  });
}

export function clampMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(Math.max(Math.trunc(ms), 0), MAX_BILLABLE_MS);
}

/**
 * kWh = watts x seconds / 3_600_000.
 * Rounded to 9 decimals to match the numeric(18,9) ledger column exactly.
 */
export function estimateKwh(ms: number, deviceClass: DeviceClass): number {
  const watts = DEVICE_WATTS[deviceClass];
  const kwh = (watts * clampMs(ms)) / 3_600_000_000;
  return Number(formatKwh(kwh));
}
