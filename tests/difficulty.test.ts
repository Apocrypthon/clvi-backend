import test from "node:test";
import assert from "node:assert/strict";

import {
  clampBits,
  DEFAULT_DIFFICULTY_BITS,
  MAX_DIFFICULTY_BITS,
  median,
  MIN_DIFFICULTY_BITS,
  nextDifficultyBits,
} from "../src/lib/difficulty.ts";

test("median handles odd and even sample counts", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("difficulty starts at 18 with no history", () => {
  assert.equal(nextDifficultyBits(null, []), DEFAULT_DIFFICULTY_BITS);
});

test("solves faster than 3 s raise difficulty by one bit", () => {
  assert.equal(nextDifficultyBits(18, [900, 1100, 1000]), 19);
});

test("solves slower than 6 s lower difficulty by one bit", () => {
  assert.equal(nextDifficultyBits(18, [7000, 9000, 8000]), 17);
});

test("solves inside the 3-6 s target hold steady", () => {
  assert.equal(nextDifficultyBits(18, [3200, 4800, 5900]), 18);
  assert.equal(nextDifficultyBits(18, [3000]), 18);
  assert.equal(nextDifficultyBits(18, [6000]), 18);
});

test("difficulty moves at most one bit per issue", () => {
  assert.equal(nextDifficultyBits(18, [1, 1, 1]), 19);
  assert.equal(nextDifficultyBits(18, [600_000]), 17);
});

test("difficulty is clamped to [12, 24]", () => {
  assert.equal(nextDifficultyBits(MAX_DIFFICULTY_BITS, [10, 10, 10]), MAX_DIFFICULTY_BITS);
  assert.equal(nextDifficultyBits(MIN_DIFFICULTY_BITS, [60_000]), MIN_DIFFICULTY_BITS);
  assert.equal(clampBits(99), MAX_DIFFICULTY_BITS);
  assert.equal(clampBits(1), MIN_DIFFICULTY_BITS);
  assert.equal(clampBits(Number.NaN), DEFAULT_DIFFICULTY_BITS);
});

test("a stored difficulty outside the bounds is pulled back in range", () => {
  assert.equal(nextDifficultyBits(40, [4000]), MAX_DIFFICULTY_BITS);
});
