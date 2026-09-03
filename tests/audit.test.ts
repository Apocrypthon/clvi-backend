import test from "node:test";
import assert from "node:assert/strict";

// Fixture secret; see tests/ledger.test.ts.
process.env["LEDGER_SECRET"] = "test-secret-do-not-use-in-production";

import { type AuditReport, reportBytes, signReport, verifyReport } from "../src/lib/audit.ts";
import { parseRange } from "../netlify/functions/audit.ts";
import { ApiError } from "../src/lib/http.ts";

const UNSIGNED: Omit<AuditReport, "signature"> = {
  rangeStart: "2026-09-01T00:00:00.000Z",
  rangeEnd: "2026-09-02T00:00:00.000Z",
  entryCount: 3,
  tokenCount: 3,
  totalEstKwh: 0.000125,
  chainOk: true,
  generatedAt: "2026-09-02T00:00:01.000Z",
};

function signed(): AuditReport {
  return { ...UNSIGNED, signature: signReport(UNSIGNED) };
}

test("report bytes are canonical and exclude the signature", () => {
  assert.equal(
    reportBytes(UNSIGNED),
    '{"chainOk":true,"entryCount":3,"generatedAt":"2026-09-02T00:00:01.000Z",' +
      '"rangeEnd":"2026-09-02T00:00:00.000Z","rangeStart":"2026-09-01T00:00:00.000Z",' +
      '"tokenCount":3,"totalEstKwh":"0.000125000"}',
  );
});

test("a freshly signed report verifies", () => {
  assert.equal(verifyReport(signed()), true);
});

test("a report survives a JSON round trip", () => {
  assert.equal(verifyReport(JSON.parse(JSON.stringify(signed()))), true);
});

test("every field is covered by the signature", () => {
  for (const [field, value] of Object.entries({
    rangeStart: "2026-08-01T00:00:00.000Z",
    rangeEnd: "2026-09-03T00:00:00.000Z",
    entryCount: 4,
    tokenCount: 2,
    totalEstKwh: 0.000126,
    chainOk: false,
    generatedAt: "2026-09-02T00:00:02.000Z",
  })) {
    assert.equal(verifyReport({ ...signed(), [field]: value }), false, `${field} was not signed`);
  }
});

test("a report signed with a different secret does not verify", () => {
  const forged = { ...UNSIGNED, signature: signReport(UNSIGNED, "some-other-secret") };
  assert.equal(verifyReport(forged), false);
});

test("malformed input answers false rather than throwing", () => {
  assert.equal(verifyReport(null), false);
  assert.equal(verifyReport("not a report"), false);
  assert.equal(verifyReport({}), false);
  assert.equal(verifyReport({ ...signed(), signature: "nothex" }), false);
  assert.equal(verifyReport({ ...signed(), entryCount: "three" }), false);
});

test("chainOk only counts as true when it is literally true", () => {
  // A tampered report cannot claim a truthy non-boolean to slip past the check.
  assert.equal(verifyReport({ ...signed(), chainOk: "true" }), false);
});

test("parseRange splits two ISO timestamps on the separator dot", () => {
  assert.deepEqual(parseRange("2026-09-01T00:00:00Z.2026-09-02T00:00:00Z"), {
    fromTs: "2026-09-01T00:00:00.000Z",
    toTs: "2026-09-02T00:00:00.000Z",
  });
});

test("parseRange handles fractional seconds on both sides", () => {
  assert.deepEqual(parseRange("2026-09-01T00:00:00.500Z.2026-09-02T12:30:00.250Z"), {
    fromTs: "2026-09-01T00:00:00.500Z",
    toTs: "2026-09-02T12:30:00.250Z",
  });
});

test("parseRange handles offset-style timestamps", () => {
  assert.deepEqual(parseRange("2026-09-01T02:00:00+02:00.2026-09-02T00:00:00Z"), {
    fromTs: "2026-09-01T00:00:00.000Z",
    toTs: "2026-09-02T00:00:00.000Z",
  });
});

test("parseRange rejects garbage and inverted ranges", () => {
  assert.throws(() => parseRange("latest.latest"), ApiError);
  assert.throws(() => parseRange("2026-09-01T00:00:00Z"), ApiError);
  assert.throws(() => parseRange("2026-09-02T00:00:00Z.2026-09-01T00:00:00Z"), ApiError);
});
