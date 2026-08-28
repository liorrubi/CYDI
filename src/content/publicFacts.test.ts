/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Pins every number the public pages state that publicFacts.ts could not import
// directly (see the header there for why app/constants.ts is unreachable from a
// Worker). Each assertion here is the difference between "the site says the game
// works this way" and "the game works this way".

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORY_UNLOCK_COST as PUBLIC_CATEGORY_UNLOCK_COST,
  COINS_PER_STAR,
  DAILY_CHEST_MAX_COINS,
  DAILY_CHEST_MIN_COINS,
  DEFAULT_DIFFICULTY_NAME,
  DIFFICULTY_FACTS,
  FIRST_ROUND_PREVIEW_SECONDS,
  PREVIEW_SECONDS,
  SCORE_BANDS,
  SHARE_LINK_EXPIRY_DAYS,
  STAR_THRESHOLDS,
} from "./publicFacts";
import {
  CATEGORY_UNLOCK_COST,
  DAILY_CHEST,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_LEVELS,
  FIRST_ROUND_PREVIEW_DURATION_MS,
  PREVIEW_DURATION_MS,
  SHAPE_CHALLENGE_COIN_REWARDS,
  STAR_RATING_THRESHOLDS,
} from "../app/constants";
import { scoreMessage } from "../engine/scoringConstants";

test("star thresholds quoted publicly match the game's", () => {
  assert.deepEqual(
    STAR_THRESHOLDS,
    STAR_RATING_THRESHOLDS.map((t) => ({ stars: t.stars, minScore: t.minScore })),
  );
});

test("score bands quoted publicly match scoreMessage()", () => {
  for (const band of SCORE_BANDS) {
    assert.equal(scoreMessage(band.minScore), band.label, `score ${band.minScore} should read "${band.label}"`);
    // And the band really does start there: one point lower must say something else.
    assert.notEqual(scoreMessage(band.minScore - 1), band.label, `${band.minScore - 1} should not still be "${band.label}"`);
  }
});

test("difficulty levels and pass scores quoted publicly match the game's", () => {
  assert.deepEqual(
    DIFFICULTY_FACTS,
    DIFFICULTY_LEVELS.map((level) => ({ name: level.name, passScore: level.passScore })),
  );
  const defaultLevel = DIFFICULTY_LEVELS.find((level) => level.id === DEFAULT_DIFFICULTY);
  assert.equal(DEFAULT_DIFFICULTY_NAME, defaultLevel?.name);
});

test("coin rewards per star quoted publicly match the game's", () => {
  for (const { stars, coins } of COINS_PER_STAR) {
    assert.equal(SHAPE_CHALLENGE_COIN_REWARDS[stars], coins, `${stars}-star reward`);
  }
  // Every paying tier is listed - a new 6th star would fail here rather than
  // leave the public table quietly short.
  const payingTiers = Object.entries(SHAPE_CHALLENGE_COIN_REWARDS).filter(([, coins]) => coins > 0);
  assert.equal(COINS_PER_STAR.length, payingTiers.length);
});

test("category unlock cost and daily chest range quoted publicly match the game's", () => {
  assert.equal(PUBLIC_CATEGORY_UNLOCK_COST, CATEGORY_UNLOCK_COST);
  assert.equal(DAILY_CHEST_MIN_COINS, DAILY_CHEST.rewardMin);
  assert.equal(DAILY_CHEST_MAX_COINS, DAILY_CHEST.rewardMax);
});

test("preview durations quoted publicly match the game's", () => {
  assert.equal(PREVIEW_SECONDS * 1000, PREVIEW_DURATION_MS);
  assert.equal(FIRST_ROUND_PREVIEW_SECONDS * 1000, FIRST_ROUND_PREVIEW_DURATION_MS);
});

test("share-link expiry quoted publicly matches the Worker's TTL", () => {
  // The TTL is a module-private const in a Worker entry module that cannot be
  // imported under plain Node (Durable Object exports, Workers globals), so this
  // pins the source line instead. Changing the TTL without changing the public
  // claim fails here.
  const workerSource = readFileSync(new URL("../../worker/index.ts", import.meta.url), "utf8");
  assert.match(
    workerSource,
    new RegExp(`const TTL_SECONDS = 60 \\* 60 \\* 24 \\* ${SHARE_LINK_EXPIRY_DAYS};`),
    `worker/index.ts no longer sets a ${SHARE_LINK_EXPIRY_DAYS}-day share TTL`,
  );
});
