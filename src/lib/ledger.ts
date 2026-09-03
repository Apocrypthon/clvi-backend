/**
 * The ledger chain.
 *
 * Two independent integrity properties, both re-derivable by anyone holding
 * LEDGER_SECRET:
 *
 *   prev_hash       = SHA-256(canonical JSON of the previous entry)   -> ordering
 *   immutable_check = HMAC-SHA256(LEDGER_SECRET, canonical JSON of this entry)
 *                                                                     -> content
 *
 * The canonical JSON of an entry deliberately excludes `immutable_check` itself
 * (a row cannot commit to its own MAC) and excludes `seq` (a database-assigned
 * ordering key that carries no player-visible meaning).
 */

import { canonicalJson, canonicalTs, formatKwh, hexEquals, hmacHex, sha256Hex } from "./canonical.ts";
import { ledgerSecret } from "./env.ts";
import { insert, PostgrestError, select } from "./db.ts";
import { ApiError } from "./http.ts";

/** prev_hash of the very first entry in the chain. */
export const GENESIS_PREV_HASH = "0".repeat(64);

/** A ledger row as it comes back from PostgREST. */
export interface LedgerRow {
  entry_id: string;
  seq: number;
  prev_hash: string;
  ts: string;
  player_id: string;
  cell_id: string;
  artifact_id: string;
  hashes: number;
  ms: number;
  est_kwh: number | string;
  immutable_check: string;
}

/** The subset of a row that is hashed. Field names are the wire (camelCase) names. */
export interface CanonicalEntry {
  artifactId: string;
  cellId: string;
  entryId: string;
  estKwh: string;
  hashes: number;
  ms: number;
  playerId: string;
  prevHash: string;
  ts: string;
}

export function toCanonicalEntry(row: LedgerRow): CanonicalEntry {
  return {
    artifactId: row.artifact_id,
    cellId: row.cell_id,
    entryId: row.entry_id,
    estKwh: formatKwh(row.est_kwh),
    hashes: Number(row.hashes),
    ms: Number(row.ms),
    playerId: row.player_id,
    prevHash: row.prev_hash,
    ts: canonicalTs(row.ts),
  };
}

export function entryBytes(entry: CanonicalEntry): string {
  return canonicalJson({ ...entry });
}

/** The hash the *next* entry must carry as its prev_hash. */
export function chainHash(entry: CanonicalEntry): string {
  return sha256Hex(entryBytes(entry));
}

export function immutableCheck(entry: CanonicalEntry, secret = ledgerSecret()): string {
  return hmacHex(secret, entryBytes(entry));
}

/** Reads the current head of the chain (highest seq), or null for an empty ledger. */
export async function readHead(): Promise<LedgerRow | null> {
  const rows = await select<LedgerRow>("ledger", {}, { order: "seq.desc", limit: 1 });
  return rows[0] ?? null;
}

export async function expectedPrevHash(head: LedgerRow | null): Promise<string> {
  return head ? chainHash(toCanonicalEntry(head)) : GENESIS_PREV_HASH;
}

export interface AppendInput {
  entryId: string;
  ts: string;
  playerId: string;
  cellId: string;
  artifactId: string;
  hashes: number;
  ms: number;
  estKwh: number;
}

const APPEND_ATTEMPTS = 4;

/**
 * Appends one entry to the chain.
 *
 * Concurrency is settled by the database, not by a lock we hold across HTTP
 * calls: `ledger.prev_hash` is UNIQUE, so two writers racing for the same head
 * cannot both succeed. The loser sees a unique violation, re-reads the head and
 * retries — which is why prev_hash is computed inside the loop.
 */
export async function appendEntry(input: AppendInput): Promise<LedgerRow> {
  let lastConflict: unknown = null;
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
    const head = await readHead();
    const prevHash = await expectedPrevHash(head);
    const entry: CanonicalEntry = {
      artifactId: input.artifactId,
      cellId: input.cellId,
      entryId: input.entryId,
      estKwh: formatKwh(input.estKwh),
      hashes: input.hashes,
      ms: input.ms,
      playerId: input.playerId,
      prevHash,
      ts: canonicalTs(input.ts),
    };
    try {
      return await insert<LedgerRow>("ledger", {
        entry_id: entry.entryId,
        prev_hash: entry.prevHash,
        ts: entry.ts,
        player_id: entry.playerId,
        cell_id: entry.cellId,
        artifact_id: entry.artifactId,
        hashes: entry.hashes,
        ms: entry.ms,
        est_kwh: entry.estKwh,
        immutable_check: immutableCheck(entry),
      });
    } catch (err) {
      if (err instanceof PostgrestError && err.isUniqueViolation) {
        lastConflict = err;
        // Someone else took this head; back off briefly and re-read it.
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new ApiError("conflict", "Ledger head contended; please retry", {
    attempts: APPEND_ATTEMPTS,
    cause: String(lastConflict),
  });
}

export interface ChainCheck {
  chainOk: boolean;
  entryCount: number;
  totalEstKwh: number;
  firstTs: string | null;
  lastTs: string | null;
  /** entry_id of the first row that failed, for operator triage. */
  brokenAt: string | null;
  reason: string | null;
}

/**
 * Fresh walk of an ordered slice of the ledger: every row's HMAC is recomputed
 * and every prev_hash is checked against the hash of the row before it.
 *
 * `seedPrevHash` is the prev_hash the first row of the slice must carry — the
 * caller supplies it from the row immediately preceding the range, so a range
 * that starts mid-chain is still verified against real history.
 */
export function walkChain(rows: LedgerRow[], seedPrevHash: string): ChainCheck {
  let expected = seedPrevHash;
  let totalMillis = 0n;
  let chainOk = true;
  let brokenAt: string | null = null;
  let reason: string | null = null;
  const secret = ledgerSecret();

  for (const row of rows) {
    const entry = toCanonicalEntry(row);
    if (chainOk && entry.prevHash !== expected) {
      chainOk = false;
      brokenAt = entry.entryId;
      reason = "prev_hash does not match the preceding entry";
    }
    if (chainOk && !hexEquals(immutableCheck(entry, secret), row.immutable_check)) {
      chainOk = false;
      brokenAt = entry.entryId;
      reason = "immutable_check does not match the row contents";
    }
    // kWh is summed in integer nano-kWh so the total never drifts on float adds.
    totalMillis += BigInt(entry.estKwh.replace(".", ""));
    expected = chainHash(entry);
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    chainOk,
    entryCount: rows.length,
    totalEstKwh: Number(nanoKwhToString(totalMillis)),
    firstTs: first ? canonicalTs(first.ts) : null,
    lastTs: last ? canonicalTs(last.ts) : null,
    brokenAt,
    reason,
  };
}

/** Renders an integer count of 1e-9 kWh units back into a fixed-decimal string. */
export function nanoKwhToString(nano: bigint): string {
  const negative = nano < 0n;
  const abs = negative ? -nano : nano;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
