import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";

import { insert, select, updateReturning } from "../../src/lib/db.ts";
import { estimateKwh, clampMs, parseDeviceClass } from "../../src/lib/energy.ts";
import { ApiError, clientIp, errorResponse, json, preflight, readJsonBody, requireMethod } from "../../src/lib/http.ts";
import { appendEntry } from "../../src/lib/ledger.ts";
import { checkPow } from "../../src/lib/pow.ts";
import { enforceLimits, ipBucket, playerBucket } from "../../src/lib/rate.ts";
import { requireHex, requireId, requireInt, requireNonce, requireUuid } from "../../src/lib/validate.ts";

/** Mirrors the client's own daily cap. */
export const DAILY_SOLVE_CAP = 60;

/** Upper bound on the hash count a client may claim; only ever recorded, never trusted. */
const MAX_CLAIMED_HASHES = 1_000_000_000;

interface ChallengeRow {
  challenge_id: string;
  salt: string;
  difficulty_bits: number;
  player_id: string;
  expires_at: string;
  used: boolean;
}

/**
 * POST /submit — verify a solve, append it to the chain, mint its Guardian token.
 *
 * Order matters. The challenge is claimed (used: false -> true) *before* the
 * proof of work is checked, so a failed attempt still burns the challenge: that
 * is what stops an attacker grinding many nonces against one salt through the
 * API. A caller who fails simply asks for a new challenge.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return preflight();
  try {
    requireMethod(req, "POST");
    const body = await readJsonBody(req);

    const challengeId = requireUuid(body, "challengeId");
    const playerId = requireId(body, "playerId");
    const cellId = requireId(body, "cellId");
    const artifactId = requireId(body, "artifactId");
    const nonce = requireNonce(body, "nonce");
    const hashes = requireInt(body, "hashes", 0, MAX_CLAIMED_HASHES);
    const ms = requireInt(body, "ms", 0, 24 * 60 * 60 * 1000);
    const deviceClass = parseDeviceClass(body["deviceClass"]);

    await enforceLimits([
      { bucket: playerBucket("submit", playerId), limit: DAILY_SOLVE_CAP, windowSeconds: 24 * 60 * 60 },
      { bucket: ipBucket("submit", clientIp(req)), limit: 120, windowSeconds: 60 * 60 },
    ]);

    const challenge = await claimChallenge(challengeId);

    if (challenge.player_id !== playerId) {
      throw new ApiError("player_mismatch", "This challenge was issued to a different player");
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      throw new ApiError("challenge_expired", "Challenge expired; request a new one", {
        expiresAt: new Date(challenge.expires_at).toISOString(),
      });
    }

    const salt = requireHex(challenge.salt, "salt", 32);
    const difficultyBits = Number(challenge.difficulty_bits);
    const pow = checkPow(salt, nonce, playerId, difficultyBits);
    if (!pow.ok) {
      throw new ApiError("insufficient_work", "Nonce does not meet the required difficulty", {
        required: difficultyBits,
        got: pow.zeroBits,
      });
    }

    // Energy is recomputed here from ms and deviceClass; the client's own kWh
    // estimate, if it sent one, is ignored. This is the number the token audits.
    // The clamped value is what gets stored, so the ledger's `ms` is always the
    // billable time -- which is also what the difficulty tuner reads back.
    const billableMs = clampMs(ms);
    const estKwh = estimateKwh(billableMs, deviceClass);

    const ts = new Date().toISOString();
    const entry = await appendEntry({
      entryId: randomUUID(),
      ts,
      playerId,
      cellId,
      artifactId,
      hashes,
      ms: billableMs,
      estKwh,
    });

    // One token per verified find. guardian_tokens.entry_id is UNIQUE, so this
    // can never mint twice for the same entry.
    const token = await insert<{ token_id: string; minted_at: string }>("guardian_tokens", {
      token_id: randomUUID(),
      entry_id: entry.entry_id,
      est_kwh: estKwh.toFixed(9),
      minted_at: new Date().toISOString(),
    });

    return json({
      tokenId: token.token_id,
      estKwh,
      mapEvent: { cellId, ts, kind: "restored" as const },
      entry: {
        entryId: entry.entry_id,
        prevHash: entry.prev_hash,
        ts,
        playerId,
        cellId,
        artifactId,
        estKwh,
        tokenId: token.token_id,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};

/**
 * Atomically claims a challenge: the `used=is.false` filter means the UPDATE
 * itself is the mutual exclusion, so two concurrent submits of the same solve
 * cannot both proceed.
 */
async function claimChallenge(challengeId: string): Promise<ChallengeRow> {
  const claimed = await updateReturning<ChallengeRow>(
    "challenges",
    { challenge_id: `eq.${challengeId}`, used: "is.false" },
    { used: true },
  );
  const row = claimed[0];
  if (row) return row;

  // Nothing claimed: either the challenge never existed or it was already spent.
  const existing = await select<ChallengeRow>(
    "challenges",
    { challenge_id: `eq.${challengeId}` },
    { select: "challenge_id", limit: 1 },
  );
  if (existing.length > 0) {
    throw new ApiError("challenge_used", "Challenge has already been submitted");
  }
  throw new ApiError("challenge_not_found", "No such challenge");
}

export const config: Config = { path: "/submit" };
