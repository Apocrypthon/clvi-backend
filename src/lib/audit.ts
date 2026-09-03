/**
 * The Guardian self-audit (persist-ant shape).
 *
 * A report is a statement about a time range that anyone can re-check: the walk
 * of prev_hash + immutable_check is done fresh from the stored rows on every
 * request, and the whole report is then signed so a copy pasted elsewhere can be
 * proven to be the report this ledger actually produced.
 */

import { canonicalJson, canonicalTs, formatKwh, hexEquals, hmacHex } from "./canonical.ts";
import { ledgerSecret } from "./env.ts";
import { count, select } from "./db.ts";
import { chainHash, GENESIS_PREV_HASH, type LedgerRow, toCanonicalEntry, walkChain } from "./ledger.ts";
import { ApiError } from "./http.ts";

/** Hard cap on rows walked in one report, so an audit can never run unbounded. */
export const MAX_AUDIT_ROWS = 1000;

export interface AuditReport {
  rangeStart: string;
  rangeEnd: string;
  entryCount: number;
  tokenCount: number;
  totalEstKwh: number;
  chainOk: boolean;
  generatedAt: string;
  signature: string;
}

/** The exact bytes that get signed — every field of the report except the signature. */
export function reportBytes(report: Omit<AuditReport, "signature">): string {
  return canonicalJson({
    chainOk: report.chainOk,
    entryCount: report.entryCount,
    generatedAt: canonicalTs(report.generatedAt),
    rangeEnd: canonicalTs(report.rangeEnd),
    rangeStart: canonicalTs(report.rangeStart),
    tokenCount: report.tokenCount,
    totalEstKwh: formatKwh(report.totalEstKwh),
  });
}

export function signReport(report: Omit<AuditReport, "signature">, secret = ledgerSecret()): string {
  return hmacHex(secret, reportBytes(report));
}

/**
 * Re-checks a report pasted back to us. Returns false rather than throwing for
 * anything malformed: an unverifiable report and a tampered one are the same
 * answer to the caller's question.
 */
export function verifyReport(candidate: unknown, secret = ledgerSecret()): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const report = candidate as Record<string, unknown>;
  const signature = report["signature"];
  if (typeof signature !== "string") return false;
  try {
    const unsigned: Omit<AuditReport, "signature"> = {
      rangeStart: String(report["rangeStart"]),
      rangeEnd: String(report["rangeEnd"]),
      entryCount: asInt(report["entryCount"]),
      tokenCount: asInt(report["tokenCount"]),
      totalEstKwh: asNumber(report["totalEstKwh"]),
      chainOk: report["chainOk"] === true,
      generatedAt: String(report["generatedAt"]),
    };
    return hexEquals(signReport(unsigned, secret), signature);
  } catch {
    return false;
  }
}

function asInt(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n)) throw new TypeError("not an integer");
  return n;
}

function asNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new TypeError("not a number");
  return n;
}

/**
 * The prev_hash the first row of a range must carry: the chain hash of the row
 * immediately before the range, or the genesis constant when the range starts at
 * the beginning of the chain.
 */
async function seedPrevHashBefore(firstSeq: number): Promise<string> {
  const before = await select<LedgerRow>(
    "ledger",
    { seq: `lt.${firstSeq}` },
    { order: "seq.desc", limit: 1 },
  );
  const previous = before[0];
  return previous ? chainHash(toCanonicalEntry(previous)) : GENESIS_PREV_HASH;
}

export interface AuditOptions {
  /**
   * "latest" audits the most recent MAX_AUDIT_ROWS entries of the chain and can
   * never fail on size; "range" audits an explicit inclusive [fromTs, toTs] and
   * refuses a window too large to walk honestly.
   */
  mode: "latest" | "range";
  fromTs?: string;
  toTs?: string;
}

async function fetchRows(options: AuditOptions): Promise<LedgerRow[]> {
  if (options.mode === "latest") {
    const rows = await select<LedgerRow>("ledger", {}, { order: "seq.desc", limit: MAX_AUDIT_ROWS });
    return rows.reverse();
  }
  const filters: Record<string, string> = {};
  if (options.fromTs && options.toTs) {
    // Two bounds on one column need PostgREST's `and=` group.
    filters["and"] = `(ts.gte.${options.fromTs},ts.lte.${options.toTs})`;
  } else if (options.fromTs) {
    filters["ts"] = `gte.${options.fromTs}`;
  } else if (options.toTs) {
    filters["ts"] = `lte.${options.toTs}`;
  }
  const rows = await select<LedgerRow>("ledger", filters, {
    order: "seq.asc",
    limit: MAX_AUDIT_ROWS + 1,
  });
  if (rows.length > MAX_AUDIT_ROWS) {
    throw new ApiError("bad_request", `Range covers more than ${MAX_AUDIT_ROWS} entries; narrow it`, {
      maxRows: MAX_AUDIT_ROWS,
    });
  }
  return rows;
}

/**
 * Counts the Guardian tokens minted for exactly the audited entries, via the
 * guardian_tokens -> ledger foreign key. Falls back to a minted_at window count
 * if the embedded filter is unavailable; the fallback can differ at a range edge,
 * so it is logged rather than silently preferred.
 */
async function countTokens(rows: LedgerRow[], firstTs: string, lastTs: string): Promise<number> {
  if (rows.length === 0) return 0;
  const firstSeq = Number((rows[0] as LedgerRow).seq);
  const lastSeq = Number((rows[rows.length - 1] as LedgerRow).seq);
  try {
    return await count(
      "guardian_tokens",
      { "ledger.and": `(seq.gte.${firstSeq},seq.lte.${lastSeq})` },
      "token_id,ledger!inner(seq)",
    );
  } catch (err) {
    console.error("token count via embedded filter failed; falling back to minted_at window", err);
    return count("guardian_tokens", { and: `(minted_at.gte.${firstTs},minted_at.lte.${lastTs})` });
  }
}

export async function buildReport(options: AuditOptions): Promise<AuditReport & { brokenAt: string | null }> {
  const rows = await fetchRows(options);
  const first = rows[0];
  const seed = first ? await seedPrevHashBefore(Number(first.seq)) : GENESIS_PREV_HASH;
  const walk = walkChain(rows, seed);

  const generatedAt = new Date().toISOString();
  const rangeStart = walk.firstTs ?? options.fromTs ?? generatedAt;
  const rangeEnd = walk.lastTs ?? options.toTs ?? generatedAt;
  const tokenCount = await countTokens(rows, rangeStart, rangeEnd);

  const unsigned: Omit<AuditReport, "signature"> = {
    rangeStart,
    rangeEnd,
    entryCount: walk.entryCount,
    tokenCount,
    totalEstKwh: walk.totalEstKwh,
    chainOk: walk.chainOk,
    generatedAt,
  };
  return { ...unsigned, signature: signReport(unsigned), brokenAt: walk.brokenAt };
}
