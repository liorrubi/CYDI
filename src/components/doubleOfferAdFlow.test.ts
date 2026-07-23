// Proves the DoubleCoinsOffer ad-outcome contract for every RewardedAdResult variant:
// only "rewarded" grants the double; "dismissed" returns to the offer (fallback
// still reachable, nothing granted); "unavailable"/"error" (which includes
// consent-blocked, load failure, timeout, and "no native adapter on web" - all of
// which surface as "unavailable") fall through to the existing math-quiz fallback.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveAdOutcome } from "./doubleOfferAdFlow";
import type { RewardedAdResult } from "../services/ads/adTypes";

test("rewarded ad grants the double and never anything else", () => {
  const result: RewardedAdResult = { status: "rewarded", reward: { type: "coins", amount: 1 } };
  assert.deepEqual(resolveAdOutcome(result), { nextPhase: "feedback", grantSource: "ad" });
});

test("dismissed ad returns to the offer with no reward", () => {
  const result: RewardedAdResult = { status: "dismissed" };
  const outcome = resolveAdOutcome(result);
  assert.equal(outcome.nextPhase, "offer");
  assert.equal(outcome.grantSource, undefined);
});

test("unavailable ad (covers consent_blocked, not_configured, no_adapter, ads_disabled) falls back to the math quiz", () => {
  for (const reason of ["consent_blocked", "not_configured", "no_adapter", "ads_disabled", "already_showing", "invalid_placement", "load_failed"] as const) {
    const result: RewardedAdResult = { status: "unavailable", reason };
    const outcome = resolveAdOutcome(result);
    assert.equal(outcome.nextPhase, "quiz", `reason=${reason}`);
    assert.equal(outcome.grantSource, undefined, `reason=${reason}`);
  }
});

test("error (sdk_error/timeout) falls back to the math quiz", () => {
  for (const reason of ["sdk_error", "timeout"] as const) {
    const result: RewardedAdResult = { status: "error", reason };
    const outcome = resolveAdOutcome(result);
    assert.equal(outcome.nextPhase, "quiz", `reason=${reason}`);
    assert.equal(outcome.grantSource, undefined, `reason=${reason}`);
  }
});
