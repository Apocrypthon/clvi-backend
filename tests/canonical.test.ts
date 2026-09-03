import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalJson,
  canonicalTs,
  formatKwh,
  hexEquals,
  hmacHex,
  leadingZeroBits,
  sha256Hex,
} from "../src/lib/canonical.ts";

test("canonicalJson sorts keys and omits whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: "x" }), '{"a":"x","b":1}');
  assert.equal(canonicalJson({ a: { z: true, y: null } }), '{"a":{"y":null,"z":true}}');
});

test("canonicalJson is stable regardless of insertion order", () => {
  const first = canonicalJson({ ts: "t", playerId: "p", cellId: "c" });
  const second = canonicalJson({ cellId: "c", ts: "t", playerId: "p" });
  assert.equal(first, second);
});

test("canonicalJson drops undefined values", () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});

test("canonicalJson refuses fractional numbers", () => {
  assert.throws(() => canonicalJson({ kwh: 0.5 }), TypeError);
});

test("canonicalJson escapes strings that could forge structure", () => {
  assert.equal(canonicalJson({ a: '","b":"x' }), '{"a":"\\",\\"b\\":\\"x"}');
});

test("formatKwh renders exactly nine decimals", () => {
  assert.equal(formatKwh(0), "0.000000000");
  assert.equal(formatKwh(0.000375), "0.000375000");
  assert.equal(formatKwh("0.000000375"), "0.000000375");
  assert.equal(formatKwh(-0), "0.000000000");
});

test("canonicalTs normalizes Postgres renderings to millisecond UTC", () => {
  assert.equal(canonicalTs("2026-09-03T00:50:00.123+00:00"), "2026-09-03T00:50:00.123Z");
  assert.equal(canonicalTs("2026-09-03T02:50:00.123+02:00"), "2026-09-03T00:50:00.123Z");
  assert.equal(canonicalTs("2026-09-03T00:50:00Z"), "2026-09-03T00:50:00.000Z");
});

test("sha256Hex matches the known digest of the empty string", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("hmacHex matches RFC 4231 test case 1", () => {
  assert.equal(
    hmacHex("\x0b".repeat(20), "Hi There"),
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  );
});

test("hexEquals compares hex safely and rejects non-hex", () => {
  assert.equal(hexEquals("00ff", "00FF"), true);
  assert.equal(hexEquals("00ff", "00fe"), false);
  assert.equal(hexEquals("00ff", "00f"), false);
  assert.equal(hexEquals("", ""), false);
  assert.equal(hexEquals("zz", "zz"), false);
});

test("leadingZeroBits counts bits, not characters", () => {
  assert.equal(leadingZeroBits("ffff"), 0);
  assert.equal(leadingZeroBits("7fff"), 1);
  assert.equal(leadingZeroBits("1fff"), 3);
  assert.equal(leadingZeroBits("0fff"), 4);
  assert.equal(leadingZeroBits("00ff"), 8);
  assert.equal(leadingZeroBits("0001"), 15);
  assert.equal(leadingZeroBits("0000ff"), 16);
});
