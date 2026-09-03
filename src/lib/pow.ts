/**
 * Proof of work.
 *
 * The preimage is `salt + ":" + nonce + ":" + playerId`. Binding the player id
 * into the preimage means a solve is worthless to anyone else, and binding the
 * server-issued salt means it cannot be pre-computed before the challenge exists.
 */

import { leadingZeroBits, sha256Hex } from "./canonical.ts";

export function powPreimage(salt: string, nonce: string, playerId: string): string {
  return `${salt}:${nonce}:${playerId}`;
}

export function powDigest(salt: string, nonce: string, playerId: string): string {
  return sha256Hex(powPreimage(salt, nonce, playerId));
}

export interface PowResult {
  digest: string;
  zeroBits: number;
  ok: boolean;
}

export function checkPow(
  salt: string,
  nonce: string,
  playerId: string,
  difficultyBits: number,
): PowResult {
  const digest = powDigest(salt, nonce, playerId);
  const zeroBits = leadingZeroBits(digest);
  return { digest, zeroBits, ok: zeroBits >= difficultyBits };
}
