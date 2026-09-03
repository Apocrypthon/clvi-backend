#!/usr/bin/env node
/**
 * Solves a STRATA proof-of-work challenge.
 *
 * Used by the verification walk in docs/STATE.md#Verify, where curl talks to the
 * deploy and this script does the hashing.
 *
 *   node scripts/solve.mjs --salt <32 hex> --bits <n> --player <playerId>
 *   node scripts/solve.mjs --challenge-json '<the /challenge response>' --player <playerId>
 *
 * Prints {"nonce","hashes","ms","digest"} on stdout.
 */

import { createHash } from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key.slice(2)] = "true";
    } else {
      args[key.slice(2)] = value;
      i += 1;
    }
  }
  return args;
}

function leadingZeroBits(hexDigest) {
  let bits = 0;
  for (const char of hexDigest) {
    const nibble = Number.parseInt(char, 16);
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}

const args = parseArgs(process.argv.slice(2));

let salt = args.salt;
let bits = args.bits === undefined ? undefined : Number(args.bits);
if (args["challenge-json"]) {
  const challenge = JSON.parse(args["challenge-json"]);
  salt ??= challenge.salt;
  bits ??= Number(challenge.difficultyBits);
}

const playerId = args.player ?? args.playerId;
const maxHashes = Number(args["max-hashes"] ?? 50_000_000);

if (!salt || !Number.isFinite(bits) || !playerId) {
  console.error("usage: solve.mjs --salt <hex> --bits <n> --player <playerId>");
  process.exit(2);
}

const started = Date.now();
let hashes = 0;
let nonce = "";
let digest = "";

for (;;) {
  nonce = `${started.toString(36)}-${hashes.toString(36)}`;
  digest = createHash("sha256").update(`${salt}:${nonce}:${playerId}`, "utf8").digest("hex");
  hashes += 1;
  if (leadingZeroBits(digest) >= bits) break;
  if (hashes >= maxHashes) {
    console.error(`gave up after ${hashes} hashes without meeting ${bits} bits`);
    process.exit(1);
  }
}

process.stdout.write(
  `${JSON.stringify({ nonce, hashes, ms: Date.now() - started, digest })}\n`,
);
