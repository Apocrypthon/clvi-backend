import test from "node:test";
import assert from "node:assert/strict";

import { clampMs, DEVICE_WATTS, estimateKwh, MAX_BILLABLE_MS, parseDeviceClass } from "../src/lib/energy.ts";
import { ApiError } from "../src/lib/http.ts";

test("device classes match the frozen contract", () => {
  assert.deepEqual(DEVICE_WATTS, { phone: 3, tablet: 5, laptop: 15, desktop: 45 });
});

test("solve time is clamped to [0, 30 s]", () => {
  assert.equal(clampMs(-1), 0);
  assert.equal(clampMs(1234), 1234);
  assert.equal(clampMs(45_000), MAX_BILLABLE_MS);
  assert.equal(clampMs(Number.NaN), 0);
});

test("estimateKwh is watts x seconds / 3.6e9", () => {
  // 45 W for the full 30 s cap.
  assert.equal(estimateKwh(30_000, "desktop"), 0.000375);
  // 3 W phone for 6 s.
  assert.equal(estimateKwh(6_000, "phone"), 0.000005);
  assert.equal(estimateKwh(0, "laptop"), 0);
});

test("estimateKwh never bills beyond the 30 s cap", () => {
  assert.equal(estimateKwh(10 * 60 * 1000, "desktop"), estimateKwh(MAX_BILLABLE_MS, "desktop"));
});

test("parseDeviceClass rejects anything off the list", () => {
  assert.equal(parseDeviceClass("tablet"), "tablet");
  assert.throws(() => parseDeviceClass("server"), ApiError);
  assert.throws(() => parseDeviceClass(undefined), ApiError);
});
