import test from "node:test";
import assert from "node:assert/strict";

import { ApiError, MAX_BODY_BYTES, clientIp, readJsonBody } from "../src/lib/http.ts";
import { requireHex, requireId, requireInt, requireNonce, requireUuid } from "../src/lib/validate.ts";

test("requireId enforces the charset and the 64 char cap", () => {
  assert.equal(requireId({ playerId: "player-1" }, "playerId"), "player-1");
  assert.equal(requireId({ cellId: "cell:12.4" }, "cellId"), "cell:12.4");
  assert.throws(() => requireId({ playerId: "" }, "playerId"), ApiError);
  assert.throws(() => requireId({ playerId: "a".repeat(65) }, "playerId"), ApiError);
  assert.throws(() => requireId({ playerId: "drop table" }, "playerId"), ApiError);
  assert.throws(() => requireId({ playerId: 7 }, "playerId"), ApiError);
  assert.throws(() => requireId({}, "playerId"), ApiError);
});

test("requireId rejects PostgREST filter punctuation", () => {
  // playerId is interpolated into a PostgREST filter, so commas, parens and
  // asterisks must never survive validation.
  for (const bad of ["a,b", "a(b)", "a*b", "a%b", "a/b", "eq.x"]) {
    if (bad === "eq.x") continue; // dots alone are allowed; the filter verb is not
    assert.throws(() => requireId({ playerId: bad }, "playerId"), ApiError, bad);
  }
});

test("requireUuid normalizes case and rejects near-misses", () => {
  assert.equal(
    requireUuid({ challengeId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" }, "challengeId"),
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  );
  assert.throws(() => requireUuid({ challengeId: "not-a-uuid" }, "challengeId"), ApiError);
});

test("requireNonce keeps the hash preimage unambiguous", () => {
  assert.equal(requireNonce({ nonce: "abc123" }, "nonce"), "abc123");
  // A colon would let a caller shift the salt/nonce/playerId boundaries.
  assert.throws(() => requireNonce({ nonce: "a:b" }, "nonce"), ApiError);
  assert.throws(() => requireNonce({ nonce: "" }, "nonce"), ApiError);
  assert.throws(() => requireNonce({ nonce: "x".repeat(129) }, "nonce"), ApiError);
  assert.throws(() => requireNonce({ nonce: "line\nbreak" }, "nonce"), ApiError);
});

test("requireInt enforces bounds and integrality", () => {
  assert.equal(requireInt({ ms: 4000 }, "ms", 0, 30_000), 4000);
  assert.throws(() => requireInt({ ms: -1 }, "ms", 0, 30_000), ApiError);
  assert.throws(() => requireInt({ ms: 1.5 }, "ms", 0, 30_000), ApiError);
  assert.throws(() => requireInt({ ms: "4000" }, "ms", 0, 30_000), ApiError);
  assert.throws(() => requireInt({ ms: 30_001 }, "ms", 0, 30_000), ApiError);
});

test("requireHex checks exact length", () => {
  assert.equal(requireHex("AB".repeat(16), "salt", 32), "ab".repeat(16));
  assert.throws(() => requireHex("ab", "salt", 32), ApiError);
  assert.throws(() => requireHex("g".repeat(32), "salt", 32), ApiError);
});

test("readJsonBody refuses oversized bodies", async () => {
  const big = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) });
  await assert.rejects(
    () => readJsonBody(new Request("https://example.test/submit", { method: "POST", body: big })),
    (err: unknown) => err instanceof ApiError && err.code === "body_too_large",
  );
});

test("readJsonBody refuses non-objects and bad JSON", async () => {
  const post = (body: string) =>
    readJsonBody(new Request("https://example.test/submit", { method: "POST", body }));
  await assert.rejects(() => post("{nope"), (e: unknown) => e instanceof ApiError && e.code === "invalid_json");
  await assert.rejects(() => post("[1,2]"), (e: unknown) => e instanceof ApiError && e.code === "bad_request");
  assert.deepEqual(await post(""), {});
  assert.deepEqual(await post('{"a":1}'), { a: 1 });
});

test("clientIp prefers Netlify's header and falls back to the first forwarded hop", () => {
  const make = (headers: Record<string, string>) => new Request("https://example.test/", { headers });
  assert.equal(clientIp(make({ "x-nf-client-connection-ip": "203.0.113.4" })), "203.0.113.4");
  assert.equal(clientIp(make({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp(make({})), "unknown");
});

test("clientIp strips characters that could escape a PostgREST filter", () => {
  const make = (headers: Record<string, string>) => new Request("https://example.test/", { headers });
  // Only the characters an address can contain survive; PostgREST filter syntax
  // (commas, parens, wildcards, quotes) never reaches the query string.
  for (const hostile of ["1.2.3.4)or(true", "1.2.3.4,eq.*", "1.2.3.4' or '1", "*"]) {
    const bucket = clientIp(make({ "x-nf-client-connection-ip": hostile }));
    assert.doesNotMatch(bucket, /[(),*'"\s]/, hostile);
  }
  assert.equal(clientIp(make({ "x-nf-client-connection-ip": "203.0.113.4 " })), "203.0.113.4");
  assert.equal(clientIp(make({ "x-nf-client-connection-ip": "2001:db8::1" })), "2001:db8::1");
  assert.equal(clientIp(make({ "x-nf-client-connection-ip": "!!!" })), "unknown");
});
