import test from "node:test";
import assert from "node:assert/strict";

import { checkPow, powDigest, powPreimage } from "../src/lib/pow.ts";
import { sha256Hex } from "../src/lib/canonical.ts";

const SALT = "0123456789abcdef0123456789abcdef";
const PLAYER = "player-one";

test("preimage is salt:nonce:playerId", () => {
  assert.equal(powPreimage(SALT, "n1", PLAYER), `${SALT}:n1:${PLAYER}`);
  assert.equal(powDigest(SALT, "n1", PLAYER), sha256Hex(`${SALT}:n1:${PLAYER}`));
});

test("a solve for one player does not verify for another", () => {
  const nonce = solve(SALT, PLAYER, 12);
  assert.equal(checkPow(SALT, nonce, PLAYER, 12).ok, true);
  assert.equal(checkPow(SALT, nonce, "player-two", 12).ok, false);
});

test("a solve for one salt does not verify against another", () => {
  const nonce = solve(SALT, PLAYER, 12);
  assert.equal(checkPow("f".repeat(32), nonce, PLAYER, 12).ok, false);
});

test("difficulty is a threshold, not an equality", () => {
  const nonce = solve(SALT, PLAYER, 14);
  const result = checkPow(SALT, nonce, PLAYER, 14);
  assert.equal(result.ok, true);
  assert.ok(result.zeroBits >= 14);
  assert.equal(checkPow(SALT, nonce, PLAYER, result.zeroBits + 1).ok, false);
});

/** Test-local solver, so the tests never import the operator script. */
function solve(salt: string, playerId: string, bits: number): string {
  for (let i = 0; i < 5_000_000; i += 1) {
    const nonce = `t${i}`;
    if (checkPow(salt, nonce, playerId, bits).ok) return nonce;
  }
  throw new Error(`no solution found for ${bits} bits`);
}
