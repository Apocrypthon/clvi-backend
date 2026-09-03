/**
 * Input validation. Every write path runs its body through these guards before
 * anything touches the database (SEED.md stack rule: "Every write path validates
 * input sizes and rate limits by playerId + IP").
 */

import { ApiError } from "./http.ts";

/** Opaque identifiers supplied by the shell: conservative charset, hard length cap. */
const ID_PATTERN = /^[A-Za-z0-9_:.\-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

export function requireId(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ApiError("bad_request", `Field "${field}" must be 1-64 chars of [A-Za-z0-9_:.-]`, { field });
  }
  return value;
}

export function requireUuid(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApiError("bad_request", `Field "${field}" must be a UUID`, { field });
  }
  return value.toLowerCase();
}

export function requireNonce(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new ApiError("bad_request", `Field "${field}" must be a 1-128 char string`, { field });
  }
  // The nonce is concatenated into a hash preimage; keep it to printable ASCII
  // without the ":" separator so the preimage cannot be ambiguous.
  if (!/^[\x21-\x39\x3b-\x7e]+$/.test(value)) {
    throw new ApiError("bad_request", `Field "${field}" must be printable ASCII and must not contain ":"`, { field });
  }
  return value;
}

export function requireInt(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError("bad_request", `Field "${field}" must be an integer in [${min}, ${max}]`, { field });
  }
  return value;
}

export function requireHex(value: unknown, field: string, chars: number): string {
  if (typeof value !== "string" || value.length !== chars || !HEX_PATTERN.test(value)) {
    throw new ApiError("bad_request", `Field "${field}" must be ${chars} hex characters`, { field });
  }
  return value.toLowerCase();
}

export function optionalIsoTs(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 40) {
    throw new ApiError("bad_request", `Field "${field}" must be an ISO-8601 timestamp`, { field });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("bad_request", `Field "${field}" must be an ISO-8601 timestamp`, { field });
  }
  return date.toISOString();
}
