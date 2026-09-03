/**
 * Rate limiting by playerId and by IP (SEED.md stack rule).
 *
 * Counts are kept in a small append-only-ish `rate_events` table: one row per
 * accepted request, counted over a sliding window. Rows older than the widest
 * window are pruned opportunistically so the table stays small.
 */

import { count, deleteWhere, insert } from "./db.ts";
import { ApiError } from "./http.ts";

export interface Limit {
  /** Bucket key, e.g. `challenge:player:abc`. Kept under 128 chars by the caller. */
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** How long any rate_events row is worth keeping. */
export const RATE_EVENT_TTL_SECONDS = 24 * 60 * 60;

export function playerBucket(route: string, playerId: string): string {
  return `${route}:player:${playerId}`.slice(0, 128);
}

export function ipBucket(route: string, ip: string): string {
  return `${route}:ip:${ip}`.slice(0, 128);
}

/**
 * Checks every limit, then records one event per bucket. Checking before
 * recording means a rejected request does not extend its own lockout.
 */
export async function enforceLimits(limits: Limit[], now = new Date()): Promise<void> {
  for (const limit of limits) {
    const since = new Date(now.getTime() - limit.windowSeconds * 1000).toISOString();
    const used = await count("rate_events", { bucket: `eq.${limit.bucket}`, ts: `gte.${since}` });
    if (used >= limit.limit) {
      throw new ApiError("rate_limited", "Rate limit exceeded", {
        bucket: limit.bucket.split(":").slice(0, 2).join(":"),
        limit: limit.limit,
        windowSeconds: limit.windowSeconds,
        retryAfterSeconds: limit.windowSeconds,
      });
    }
  }
  await Promise.all(
    limits.map((limit) =>
      insert("rate_events", { bucket: limit.bucket, ts: now.toISOString() }).catch((err) => {
        // A missed count must never fail an otherwise valid solve.
        console.error("rate_events insert failed", err);
        return null;
      }),
    ),
  );
}

/** Opportunistic cleanup; safe to call on a fraction of requests. */
export async function pruneRateEvents(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - RATE_EVENT_TTL_SECONDS * 1000).toISOString();
  await deleteWhere("rate_events", { ts: `lt.${cutoff}` }).catch((err) => {
    console.error("rate_events prune failed", err);
  });
}
