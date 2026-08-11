// Proves the DoubleCoinsOffer ad-outcome contract for every RewardedAdResult variant.
// Watching an ad is the ONLY route to the double: only "rewarded" grants it, and NO
// outcome routes to a substitute. "dismissed" returns to the offer (nothing granted,
// the player may retry); "unavailable"/"error" (which includes consent-blocked, load
// failure, timeout, and "no native adapter on web" - all of which surface as
// "unavailable") also return to the offer, flagged so the UI shows a short
// "ads aren't available" note instead of granting anything.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { consumesDoubleAttempt, resolveAdOutcome } from "./doubleOfferAdFlow";
import type { RewardedAdResult } from "../services/ads/adTypes";

const ALL_UNAVAILABLE_REASONS = [
  "consent_blocked",
  "not_configured",
  "no_adapter",
  "ads_disabled",
  "already_showing",
  "invalid_placement",
  "load_failed",
] as const;

test("rewarded ad grants the double and never anything else", () => {
  const result: RewardedAdResult = { status: "rewarded", reward: { type: "coins", amount: 1 } };
  assert.deepEqual(resolveAdOutcome(result), { nextPhase: "feedback", grantSource: "ad" });
});

test("dismissed ad returns to the offer with no reward and no notice", () => {
  const result: RewardedAdResult = { status: "dismissed" };
  assert.deepEqual(resolveAdOutcome({ ...result }), { nextPhase: "offer" });
});

test("unavailable ad returns to the offer flagged unavailable - never a substitute route", () => {
  for (const reason of ALL_UNAVAILABLE_REASONS) {
    const result: RewardedAdResult = { status: "unavailable", reason };
    assert.deepEqual(resolveAdOutcome(result), { nextPhase: "offer", adUnavailable: true }, `reason=${reason}`);
  }
});

test("error (sdk_error/timeout) returns to the offer flagged unavailable - never a substitute route", () => {
  for (const reason of ["sdk_error", "timeout"] as const) {
    const result: RewardedAdResult = { status: "error", reason };
    assert.deepEqual(resolveAdOutcome(result), { nextPhase: "offer", adUnavailable: true }, `reason=${reason}`);
  }
});

const EVERY_RESULT: RewardedAdResult[] = [
  { status: "rewarded", reward: { type: "coins", amount: 1 } },
  { status: "dismissed" },
  ...ALL_UNAVAILABLE_REASONS.map((reason) => ({ status: "unavailable", reason }) as RewardedAdResult),
  ...(["sdk_error", "timeout"] as const).map((reason) => ({ status: "error", reason }) as RewardedAdResult),
];

// The guarantee the whole change rests on: no non-"rewarded" outcome may ever grant.
test("no outcome except a confirmed ad reward ever sets grantSource, and none routes to a quiz", () => {
  for (const result of EVERY_RESULT) {
    const outcome = resolveAdOutcome(result);
    assert.notEqual(outcome.nextPhase as string, "quiz", `${result.status} must not route to the quiz`);
    if (result.status !== "rewarded") {
      assert.equal(outcome.grantSource, undefined, `${result.status} must not grant`);
    }
  }
});

// --- Daily cap consumption (paid shop chests) ---------------------------------------

test("a confirmed ad reward consumes exactly one daily double attempt", () => {
  const outcome = resolveAdOutcome({ status: "rewarded", reward: { type: "coins", amount: 1 } });
  assert.equal(consumesDoubleAttempt(outcome), true);
  // Idempotent/pure: asking again must not imply a second charge.
  assert.equal(consumesDoubleAttempt(outcome), true);
  assert.equal(EVERY_RESULT.map(resolveAdOutcome).filter(consumesDoubleAttempt).length, 1, "exactly one of all outcomes may charge");
});

test("dismissed without a reward does NOT consume a daily double attempt", () => {
  assert.equal(consumesDoubleAttempt(resolveAdOutcome({ status: "dismissed" })), false);
});

test("unavailable (incl. ads_disabled, consent_blocked, no_adapter, not_configured, load_failed) does NOT consume a daily double attempt", () => {
  for (const reason of ALL_UNAVAILABLE_REASONS) {
    assert.equal(consumesDoubleAttempt(resolveAdOutcome({ status: "unavailable", reason })), false, `reason=${reason}`);
  }
});

test("error (sdk_error/timeout) does NOT consume a daily double attempt", () => {
  for (const reason of ["sdk_error", "timeout"] as const) {
    assert.equal(consumesDoubleAttempt(resolveAdOutcome({ status: "error", reason })), false, `reason=${reason}`);
  }
});

test("consuming a daily attempt and granting the double are the same condition - they can never diverge", () => {
  for (const result of EVERY_RESULT) {
    const outcome = resolveAdOutcome(result);
    assert.equal(
      consumesDoubleAttempt(outcome),
      outcome.grantSource === "ad",
      `${result.status}: a cap charge must happen exactly when the double is granted`,
    );
  }
});
