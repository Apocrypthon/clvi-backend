import { randomBytes, randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";

import { insert, select } from "../../src/lib/db.ts";
import {
  DEFAULT_DIFFICULTY_BITS,
  nextDifficultyBits,
  TUNING_SAMPLE_SIZE,
} from "../../src/lib/difficulty.ts";
import { clientIp, errorResponse, json, preflight, readJsonBody, requireMethod } from "../../src/lib/http.ts";
import { enforceLimits, ipBucket, playerBucket, pruneRateEvents } from "../../src/lib/rate.ts";
import { requireId } from "../../src/lib/validate.ts";

/** A challenge is solvable for 90 seconds, then it is dead whether used or not. */
export const CHALLENGE_TTL_MS = 90_000;

interface ChallengeRow {
  challenge_id: string;
  salt: string;
  difficulty_bits: number;
  expires_at: string;
}

/**
 * POST /challenge — issue a single-use proof-of-work challenge.
 *
 * Difficulty is per player and moves at most one bit per issue, aiming to hold
 * that player's median solve time inside 3-6 s (see src/lib/difficulty.ts).
 */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return preflight();
  try {
    requireMethod(req, "POST");
    const body = await readJsonBody(req);
    const playerId = requireId(body, "playerId");

    await enforceLimits([
      { bucket: playerBucket("challenge", playerId), limit: 30, windowSeconds: 60 },
      { bucket: ipBucket("challenge", clientIp(req)), limit: 90, windowSeconds: 60 },
    ]);

    const [lastChallenges, recentEntries] = await Promise.all([
      select<{ difficulty_bits: number }>(
        "challenges",
        { player_id: `eq.${playerId}` },
        { select: "difficulty_bits", order: "created_at.desc", limit: 1 },
      ),
      select<{ ms: number }>(
        "ledger",
        { player_id: `eq.${playerId}` },
        { select: "ms", order: "seq.desc", limit: TUNING_SAMPLE_SIZE },
      ),
    ]);

    const previousBits = lastChallenges[0]?.difficulty_bits ?? null;
    const difficultyBits = nextDifficultyBits(
      previousBits === null ? DEFAULT_DIFFICULTY_BITS : Number(previousBits),
      recentEntries.map((row) => Number(row.ms)),
    );

    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    const row = await insert<ChallengeRow>("challenges", {
      challenge_id: randomUUID(),
      salt: randomBytes(16).toString("hex"),
      difficulty_bits: difficultyBits,
      player_id: playerId,
      expires_at: expiresAt,
      used: false,
    });

    // Cheap housekeeping on a small slice of traffic.
    if (Math.random() < 0.02) await pruneRateEvents();

    return json({
      challengeId: row.challenge_id,
      salt: row.salt,
      difficultyBits: Number(row.difficulty_bits),
      expiresAt: new Date(row.expires_at).toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: "/challenge" };
