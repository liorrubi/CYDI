// Rewarded Ads Experiment v1, server side: the experiment keys validate only as a complete,
// consistent block; every older payload stays valid; AE schema 3 stores the arm / offer number
// / session games / bonus coins; the economy report counts the flat "plus100" coins.
import test from "node:test";
import assert from "node:assert/strict";

const { validateEventParams } = await import("../src/services/analyticsSchema.ts");
const { buildShadowDataPointsFromParsed } = await import("./analyticsShadow.ts");
const { parseIngest } = await import("./analyticsIngest.ts");
const { economyTelemetryFromRows, buildEconomyAeQueries } = await import("./analyticsEconomyReport.ts");

const valid = (name: string, params: unknown) => validateEventParams(name as never, params).valid;
const PLACEMENT = { placement: "shape_challenge_double_reward" };
const ECON = { balanceBucket: "100_499", baseReward: 40, adAvailable: true, nextTarget: "category", shortfallBucket: "short_50_75", adClosesGap: false, gamesBucket: "10_24" };
const X3 = { ...PLACEMENT, ...ECON, multiplier: 3, arm: "x3", offerNumber: 2, sessionGames: 8, bonusCoins: 80, interstitialArm: "treatment" };
const PLUS = { ...PLACEMENT, ...ECON, multiplier: 1, arm: "plus100", offerNumber: 1, sessionGames: 3, bonusCoins: 100, interstitialArm: "none" };
const FUNNEL = ["reward_offer_shown", "reward_ad_started", "reward_ad_completed", "reward_ad_failed", "reward_skipped"];

test("both arms validate on every funnel event", () => {
  for (const ev of FUNNEL) {
    assert.equal(valid(ev, X3), true, `${ev} x3`);
    assert.equal(valid(ev, PLUS), true, `${ev} plus100`);
  }
});

test("the multiplier must agree with the arm", () => {
  assert.equal(valid("reward_offer_shown", { ...X3, multiplier: 1 }), false);
  assert.equal(valid("reward_offer_shown", { ...X3, multiplier: 2 }), false);
  assert.equal(valid("reward_offer_shown", { ...PLUS, multiplier: 3 }), false);
});

test("the experiment block is all-or-nothing and bounded", () => {
  const { sessionGames: _omit, ...partial } = X3;
  assert.equal(valid("reward_offer_shown", partial), false, "missing a key");
  assert.equal(valid("reward_offer_shown", { ...X3, extra: 1 }), false, "extra key");
  assert.equal(valid("reward_offer_shown", { ...X3, arm: "x2" }), false, "unknown arm");
  assert.equal(valid("reward_offer_shown", { ...X3, offerNumber: 0 }), false);
  assert.equal(valid("reward_offer_shown", { ...X3, bonusCoins: 0 }), false);
  assert.equal(valid("reward_offer_shown", { ...X3, sessionGames: -1 }), false);
  assert.equal(valid("reward_offer_shown", { ...X3, interstitialArm: "unassigned" }), false, "unknown interstitial arm");
  const { interstitialArm: _ia, ...noIa } = X3;
  assert.equal(valid("reward_offer_shown", noIa), false, "interstitialArm is part of the block");
  assert.equal(valid("reward_offer_shown", { ...X3, interstitialArm: "control" }), true);
});

test("older payloads stay valid; multiplier 1 is only legal inside the experiment block", () => {
  assert.equal(valid("reward_offer_shown", PLACEMENT), true);
  assert.equal(valid("reward_offer_shown", { ...PLACEMENT, ...ECON, multiplier: 2 }), true);
  assert.equal(valid("reward_bonus_offer_shown", { ...PLACEMENT, ...ECON, multiplier: 3 }), true);
  assert.equal(valid("reward_offer_shown", { ...PLACEMENT, ...ECON, multiplier: 1 }), false);
});

test("reward_continuation validates", () => {
  assert.equal(valid("reward_continuation", { arm: "plus100", offerNumber: 3, outcome: "skipped" }), true);
  assert.equal(valid("reward_continuation", { arm: "x3", offerNumber: 1, outcome: "completed" }), true);
  assert.equal(valid("reward_continuation", { arm: "x3", offerNumber: 1, outcome: "abandoned" }), false);
  assert.equal(valid("reward_continuation", { arm: "x3", offerNumber: 1 }), false);
});

const env1 = (eventName: string, params: unknown) => ({ eventName, params, platform: "android", appVersion: "0.55.0", installationId: "inst-1", sessionId: "sess-1" });

test("AE schema 3: arm, offer number, session games and bonus coins land on reward rows", () => {
  const body = JSON.stringify({ events: [env1("reward_ad_completed", PLUS), env1("reward_offer_shown", X3), env1("reward_continuation", { arm: "x3", offerNumber: 2, outcome: "completed" })] });
  const [plus, x3, cont] = buildShadowDataPointsFromParsed(parseIngest("/events", body), "DE", () => 0);
  assert.equal(plus.doubles[0], 3, "schema version 3");
  assert.equal(plus.blobs[17], "plus100", "blob18 arm");
  assert.equal(plus.doubles[4], 3, "double5 sessionGames");
  assert.equal(plus.doubles[5], 1, "double6 offerNumber");
  assert.equal(plus.doubles[9], 100, "double10 bonusCoins");
  assert.equal(plus.doubles[15], 1, "double16 multiplier 1 = flat bonus");
  assert.equal(plus.blobs[18], "none", "blob19 = interstitialArm on reward funnel rows");
  assert.equal(x3.blobs[18], "treatment");
  assert.equal(x3.blobs[17], "x3");
  assert.equal(x3.doubles[15], 3);
  assert.equal(x3.doubles[9], 80);
  assert.equal(cont.blobs[17], "x3");
  assert.equal(cont.blobs[18], "completed", "blob19 outcome");
  assert.equal(cont.doubles[5], 2, "double6 offerNumber");
});

test("economy report counts the flat bonus from bonusCoins and labels it", () => {
  const q = buildEconomyAeQueries(0, 86_400_000);
  assert.match(q.earnAd, /if\(double10 > 0, double10, double18 \* \(double16 - 1\)\)/);
  assert.doesNotMatch(q.earnAd, /multiIf/i);
  const t = economyTelemetryFromRows(
    {
      earnAd: [
        { aud: "external", m: 1, n: 4, coins: 400 },
        { aud: "external", m: 3, n: 2, coins: 160 },
      ],
      funnelReward: [{ ev: "reward_offer_shown", aud: "external", k: 11, avail: 1, n: 5 }],
    },
    "external",
  );
  assert.deepEqual(t.sourceMix.ad_bonus_plus100, { events: 4, coins: 400 });
  assert.deepEqual(t.sourceMix.ad_multiplier_x3, { events: 2, coins: 160 });
  assert.ok(t.rewardFunnel.byMultiplierRewardSize["plus100|1_49"], "flat-bonus offers get their own label");
});
