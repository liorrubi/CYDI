// 0.57.0: the optional `skipStage` on reward_skipped / reward_bonus_skipped. No new event name and no
// new AE column: the validators accept the old key sets AND the new form, and the Worker's shadow
// write puts the value in the free blob20 "detail" slot.
import test from "node:test";
import assert from "node:assert/strict";

const { validateEventParams, ANALYTICS_EVENT_NAMES, REWARD_SKIP_STAGES } = await import("../src/services/analyticsSchema.ts");
const { buildShadowDataPoints } = await import("./analyticsShadow.ts");
const { REWARDED_AD_PLACEMENTS } = await import("../src/services/ads/adPlacements.ts");

const placement = REWARDED_AD_PLACEMENTS[0];
const economy = {
  balanceBucket: "b50_99",
  baseReward: 35,
  multiplier: 3,
  adAvailable: true,
  nextTarget: "none",
  shortfallBucket: "none",
  adClosesGap: false,
  gamesBucket: "g1_5",
} as Record<string, unknown>;

// Borrow real bucket values from the live economy module rather than guessing the enums.
const E = await import("../src/services/economyBuckets.ts");
economy.balanceBucket = E.BALANCE_BUCKETS[1];
economy.nextTarget = E.NEXT_TARGETS[1];
economy.shortfallBucket = E.SHORTFALL_BUCKETS[1];
economy.gamesBucket = E.GAMES_BUCKETS[1];

const experiment = { arm: "x3", offerNumber: 1, sessionGames: 3, bonusCoins: 70, interstitialArm: "none" };
const SKIP_EVENTS = ["reward_skipped", "reward_bonus_skipped"] as const;

test("skipStage values are exactly offer | ad", () => {
  assert.deepEqual([...REWARD_SKIP_STAGES], ["offer", "ad"]);
});

test("old key sets stay valid on both skip events: placement only, economy, economy + experiment", () => {
  for (const name of SKIP_EVENTS) {
    assert.equal(validateEventParams(name, { placement }).valid, true, `${name} placement only`);
    assert.equal(validateEventParams(name, { placement, ...economy }).valid, true, `${name} economy`);
    assert.equal(validateEventParams(name, { placement, ...economy, ...experiment }).valid, true, `${name} experiment`);
  }
});

test("the new form validates, carries skipStage through, and rejects anything else", () => {
  for (const name of SKIP_EVENTS) {
    for (const stage of REWARD_SKIP_STAGES) {
      for (const base of [{ placement }, { placement, ...economy }, { placement, ...economy, ...experiment }]) {
        const result = validateEventParams(name, { ...base, skipStage: stage });
        assert.equal(result.valid, true, `${name} ${stage} ${Object.keys(base).length} keys`);
        if (result.valid) assert.equal((result.params as { skipStage?: string }).skipStage, stage);
      }
    }
    assert.equal(validateEventParams(name, { placement, skipStage: "other" }).valid, false);
    assert.equal(validateEventParams(name, { placement, skipStage: 1 }).valid, false);
    assert.equal(validateEventParams(name, { placement, skipStage: undefined }).valid, false);
    assert.equal(validateEventParams(name, { placement, skipStage: "ad", extra: 1 }).valid, false, "no other key rides along");
    assert.equal(validateEventParams(name, { skipStage: "ad" }).valid, false, "skipStage alone is not a payload");
    assert.equal(validateEventParams(name, { placement: "hacked", skipStage: "ad" }).valid, false);
    // A partial economy block is still all-or-nothing.
    assert.equal(validateEventParams(name, { placement, balanceBucket: economy.balanceBucket, skipStage: "ad" }).valid, false);
  }
});

test("skipStage is accepted ONLY on the two skip events", () => {
  for (const name of ["reward_offer_shown", "reward_ad_started", "reward_ad_completed", "reward_ad_failed", "reward_bonus_ad_failed", "reward_bonus_offer_shown"] as const) {
    assert.equal(validateEventParams(name, { placement, skipStage: "ad" }).valid, false, name);
  }
  assert.ok(!ANALYTICS_EVENT_NAMES.some((n) => /skip_?stage|dismiss.*offer/i.test(n)), "no new event name for the dismissal");
});

test("shadow write: skipStage lands in blob20 detail with no new column; older rows leave it empty", () => {
  const point = (name: string, params: Record<string, unknown>) =>
    buildShadowDataPoints(
      "/event",
      JSON.stringify({ eventName: name, params, platform: "android", appVersion: "0.57.0", appVersionCode: 57, installationId: "inst-1234567890ab", sessionId: "sess-1234567890ab", isInternal: false }),
      "de",
      () => 0.5,
    )[0];
  const full = { placement, ...economy, ...experiment };
  for (const name of SKIP_EVENTS) {
    const adStage = point(name, { ...full, skipStage: "ad" });
    assert.equal(adStage.blobs.length, 20);
    assert.equal(adStage.doubles.length, 20);
    assert.equal(adStage.blobs[19], "skipStage:ad");
    assert.equal(point(name, { ...full, skipStage: "offer" }).blobs[19], "skipStage:offer");
    // The experiment slots on the same row are unaffected.
    assert.equal(adStage.blobs[17], "x3", "arm");
    assert.equal(adStage.doubles[9], 70, "bonusCoins");
    assert.equal(point(name, full).blobs[19], "", "old form: empty detail");
    assert.equal(point(name, { placement }).blobs[19], "");
  }
  // An invalid stage never reaches AE.
  assert.deepEqual(buildShadowDataPoints("/event", JSON.stringify({ eventName: "reward_skipped", params: { placement, skipStage: "nope" }, platform: "android", installationId: "inst-1234567890ab", sessionId: "sess-1234567890ab" }), "de"), []);
});
