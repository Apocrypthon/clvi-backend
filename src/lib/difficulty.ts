/**
 * Proof-of-work difficulty tuning.
 *
 * The target is an observed median solve time of 3-6 s. Each new challenge for a
 * player starts from the difficulty of their last challenge and moves by at most
 * one bit (one bit ~= a doubling of expected work), so the series converges
 * without oscillating.
 */

export const DEFAULT_DIFFICULTY_BITS = 18;
export const MIN_DIFFICULTY_BITS = 12;
export const MAX_DIFFICULTY_BITS = 24;
export const TARGET_MIN_MS = 3000;
export const TARGET_MAX_MS = 6000;

/** How many of a player's recent solves feed the median. */
export const TUNING_SAMPLE_SIZE = 9;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function clampBits(bits: number): number {
  if (!Number.isFinite(bits)) return DEFAULT_DIFFICULTY_BITS;
  return Math.min(Math.max(Math.round(bits), MIN_DIFFICULTY_BITS), MAX_DIFFICULTY_BITS);
}

/**
 * @param previousBits difficulty of this player's last issued challenge
 * @param recentMs     solve times of this player's most recent ledger entries
 */
export function nextDifficultyBits(previousBits: number | null, recentMs: number[]): number {
  const base = clampBits(previousBits ?? DEFAULT_DIFFICULTY_BITS);
  const observed = median(recentMs);
  if (observed === null) return base;
  if (observed < TARGET_MIN_MS) return clampBits(base + 1);
  if (observed > TARGET_MAX_MS) return clampBits(base - 1);
  return base;
}
