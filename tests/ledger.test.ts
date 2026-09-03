import test from "node:test";
import assert from "node:assert/strict";

// The ledger reads LEDGER_SECRET at call time; these tests pin a known value so
// the expected HMACs below are reproducible. It is a test fixture, not a secret.
process.env["LEDGER_SECRET"] = "test-secret-do-not-use-in-production";

import { sha256Hex } from "../src/lib/canonical.ts";
import {
  chainHash,
  entryBytes,
  GENESIS_PREV_HASH,
  immutableCheck,
  type CanonicalEntry,
  type LedgerRow,
  nanoKwhToString,
  toCanonicalEntry,
  walkChain,
} from "../src/lib/ledger.ts";

const SECRET = "test-secret-do-not-use-in-production";

function row(overrides: Partial<LedgerRow> & Pick<LedgerRow, "entry_id" | "prev_hash" | "seq">): LedgerRow {
  const base: LedgerRow = {
    ts: "2026-09-03T00:00:00.000Z",
    player_id: "player-one",
    cell_id: "cell-7",
    artifact_id: "can-tab",
    hashes: 1000,
    ms: 4000,
    est_kwh: 0.00005,
    immutable_check: "0".repeat(64),
    ...overrides,
  };
  return { ...base, immutable_check: immutableCheck(toCanonicalEntry(base), SECRET) };
}

/** Builds a well-formed chain of `n` entries starting from genesis. */
function chainOf(n: number): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let prev = GENESIS_PREV_HASH;
  for (let i = 0; i < n; i += 1) {
    const built = row({
      entry_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      seq: i + 1,
      prev_hash: prev,
      ts: new Date(Date.UTC(2026, 8, 3, 0, 0, i)).toISOString(),
    });
    rows.push(built);
    prev = chainHash(toCanonicalEntry(built));
  }
  return rows;
}

test("canonical entry bytes exclude seq and immutable_check", () => {
  const entry = toCanonicalEntry(chainOf(1)[0] as LedgerRow);
  const bytes = entryBytes(entry);
  assert.ok(!bytes.includes("seq"));
  assert.ok(!bytes.includes("immutable_check"));
  assert.ok(!bytes.includes("immutableCheck"));
  assert.equal(
    bytes,
    '{"artifactId":"can-tab","cellId":"cell-7","entryId":"00000000-0000-4000-8000-000000000000",' +
      '"estKwh":"0.000050000","hashes":1000,"ms":4000,"playerId":"player-one",' +
      `"prevHash":"${GENESIS_PREV_HASH}","ts":"2026-09-03T00:00:00.000Z"}`,
  );
});

test("chainHash is SHA-256 over the canonical entry bytes", () => {
  const entry = toCanonicalEntry(chainOf(1)[0] as LedgerRow);
  assert.equal(chainHash(entry), sha256Hex(entryBytes(entry)));
});

test("immutable_check depends on the secret", () => {
  const entry: CanonicalEntry = toCanonicalEntry(chainOf(1)[0] as LedgerRow);
  assert.notEqual(immutableCheck(entry, SECRET), immutableCheck(entry, "another-secret"));
});

test("a well-formed chain walks clean from genesis", () => {
  const result = walkChain(chainOf(4), GENESIS_PREV_HASH);
  assert.equal(result.chainOk, true);
  assert.equal(result.entryCount, 4);
  assert.equal(result.brokenAt, null);
  assert.equal(result.firstTs, "2026-09-03T00:00:00.000Z");
  assert.equal(result.lastTs, "2026-09-03T00:00:03.000Z");
});

test("an empty range is vacuously ok", () => {
  const result = walkChain([], GENESIS_PREV_HASH);
  assert.equal(result.chainOk, true);
  assert.equal(result.entryCount, 0);
  assert.equal(result.totalEstKwh, 0);
  assert.equal(result.firstTs, null);
});

test("editing a row's content breaks its immutable_check", () => {
  const rows = chainOf(3);
  (rows[1] as LedgerRow).est_kwh = 9.999999999;
  const result = walkChain(rows, GENESIS_PREV_HASH);
  assert.equal(result.chainOk, false);
  assert.equal(result.brokenAt, (rows[1] as LedgerRow).entry_id);
  assert.match(result.reason ?? "", /immutable_check/);
});

test("re-signing an edited row still breaks the prev_hash chain", () => {
  const rows = chainOf(3);
  const tampered = rows[1] as LedgerRow;
  tampered.cell_id = "cell-999";
  // An attacker with the secret could repair the row MAC...
  tampered.immutable_check = immutableCheck(toCanonicalEntry(tampered), SECRET);
  // ...but the entry after it still commits to the original bytes.
  const result = walkChain(rows, GENESIS_PREV_HASH);
  assert.equal(result.chainOk, false);
  assert.equal(result.brokenAt, (rows[2] as LedgerRow).entry_id);
  assert.match(result.reason ?? "", /prev_hash/);
});

test("dropping an entry from the middle breaks the chain", () => {
  const rows = chainOf(4);
  const result = walkChain([rows[0], rows[1], rows[3]] as LedgerRow[], GENESIS_PREV_HASH);
  assert.equal(result.chainOk, false);
  assert.equal(result.brokenAt, (rows[3] as LedgerRow).entry_id);
});

test("a mid-chain range verifies against the seed prev_hash of the row before it", () => {
  const rows = chainOf(4);
  const seed = (rows[2] as LedgerRow).prev_hash;
  assert.equal(walkChain(rows.slice(2), seed).chainOk, true);
  // The same slice checked as if it started the chain must fail.
  assert.equal(walkChain(rows.slice(2), GENESIS_PREV_HASH).chainOk, false);
});

test("kWh totals are summed as integers, so they never drift", () => {
  const rows = chainOf(3).map((r, i) => ({ ...r, est_kwh: [0.1, 0.2, 0.000000001][i] as number }));
  // 0.1 + 0.2 !== 0.3 in binary floating point; the integer sum is exact.
  assert.equal(walkChain(rows, GENESIS_PREV_HASH).totalEstKwh, 0.300000001);
});

test("nanoKwhToString pads the fractional part", () => {
  assert.equal(nanoKwhToString(0n), "0.000000000");
  assert.equal(nanoKwhToString(375n), "0.000000375");
  assert.equal(nanoKwhToString(1_000_000_001n), "1.000000001");
});
