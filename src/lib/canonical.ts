/**
 * Canonical JSON + hashing primitives.
 *
 * Every hash and signature in this repo is taken over a *canonical* JSON string
 * so that the same logical row always produces the same bytes, whichever process
 * (append, audit walk, or a third party re-checking a pasted report) computes it.
 *
 * Canonical form:
 *   - object keys sorted by UTF-16 code unit (JS default lexicographic sort)
 *   - no insignificant whitespace
 *   - numbers restricted to safe integers (kWh values travel as fixed-decimal
 *     strings instead — see `formatKwh`)
 *   - undefined-valued keys omitted
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined };

export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        `canonicalJson: only safe integers may be serialized as numbers (got ${value}); use formatKwh() for fractional values`,
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as CanonicalValue)}`)
    .join(",");
  return `{${body}}`;
}

/** kWh precision used everywhere: DB column is numeric(18,9). */
export const KWH_DECIMALS = 9;

/** Fixed-decimal rendering of a kWh amount, so canonical bytes never depend on float formatting. */
export function formatKwh(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) throw new TypeError(`formatKwh: not a finite number (${value})`);
  // Avoid "-0.000000000".
  const fixed = n.toFixed(KWH_DECIMALS);
  return fixed === `-${(0).toFixed(KWH_DECIMALS)}` ? (0).toFixed(KWH_DECIMALS) : fixed;
}

/**
 * Timestamps are canonicalized to ISO-8601 with exactly millisecond precision
 * and a `Z` suffix, so Postgres' microsecond rendering (`+00:00`, trailing
 * digits) can never change the bytes we hash. All ledger rows are written with
 * millisecond precision, which makes this round-trip lossless.
 */
export function canonicalTs(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`canonicalTs: invalid timestamp (${String(value)})`);
  return date.toISOString();
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hmacHex(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

/** Constant-time hex comparison; false for anything that is not the same length hex. */
export function hexEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), "hex"), Buffer.from(b.toLowerCase(), "hex"));
}

/** Number of leading zero *bits* in a hex digest. */
export function leadingZeroBits(hexDigest: string): number {
  let bits = 0;
  for (const char of hexDigest) {
    const nibble = Number.parseInt(char, 16);
    if (Number.isNaN(nibble)) break;
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    // 8 -> 0, 4 -> 1, 2 -> 2, 1 -> 3
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}
