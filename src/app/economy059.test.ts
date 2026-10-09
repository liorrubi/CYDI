// 0.59.0 economy release - the pure rules: category prices by purchase order, Shop prices, the Daily Drawing Streak
// (rollover, gaps, Saves, rewards, Ember), Category Unlock Now, the x3run bonus and assignment, the coin-offer flag
// schema, and the analytics shapes the new code sends (validated by the shared schema the Worker uses).
import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_UNLOCK_COST, categoryUnlockPrice, DAILY_GOAL_COINS, DAILY_GOAL_GAMES, PAID_CHEST_AD_BONUS_CAP, PEN_COLORS, PEN_SKINS } from "./constants";
import {
  completeStreakDay,
  daysBetween,
  EMPTY_STREAK,
  earnsStreakSave,
  isStreakMilestone,
  normalizeStreak,
  streakRewardFor,
  viewStreak,
  type StreakState,
} from "./drawingStreak";
import { isUnlockNowEligible, unlockNowCredit, UNLOCK_NOW_MAX_TOPUP } from "./unlockNow";
import { assignRunArm, getRewardedArm, runOfferBonus, RUN_BONUS_MAX, RUN_BONUS_MIN } from "./rewardedOfferCadence";
import { isValidStoredCoinOfferConfig, parseClientCoinOfferConfig, parseStoredCoinOfferConfig } from "../services/ads/coinOfferConfigSchema";
import { validateEventParams } from "../services/analyticsSchema";

// ------------------------------------------------------------------ prices ----

test("categories are priced by purchase order: 1,000 / 1,250 / 1,500 and 1,500 from the 3rd on", () => {
  assert.equal(CATEGORY_UNLOCK_COST, 1000, "the first paid category (and the 1k milestone) is unchanged");
  assert.deepEqual([0, 1, 2, 3, 10, 11].map(categoryUnlockPrice), [1000, 1250, 1500, 1500, 1500, 1500]);
  assert.equal(categoryUnlockPrice(-3), 1000);
  assert.equal(categoryUnlockPrice(Number.NaN), 1000);
});

test("Shop prices: basic inks 750, Rainbow 6,000, Diamond Blue 9,000; pens unchanged; Ember is never for sale", () => {
  const price = (id: string) => PEN_COLORS.find((c) => c.id === id)?.price;
  assert.deepEqual(["purple", "green", "orange", "rainbow", "diamondBlue"].map(price), [750, 750, 750, 6000, 9000]);
  const ember = PEN_COLORS.find((c) => c.id === "ember")!;
  assert.equal(ember.price, undefined);
  assert.equal(ember.exclusive, true);
  assert.deepEqual(PEN_SKINS.map((s) => s.price ?? 0), [0, 1000, 2500, 5000, 7500, 12000, 20000]);
  assert.equal(PAID_CHEST_AD_BONUS_CAP, 500);
  assert.equal(DAILY_GOAL_GAMES, 5);
  assert.equal(DAILY_GOAL_COINS, 20);
});

// ------------------------------------------------------------------ streak ----

const at = (lastDay: string, current: number, extra: Partial<StreakState> = {}): StreakState => ({ ...EMPTY_STREAK, lastDay, current, best: current, ...extra });

test("streak rewards follow the approved schedule: 1,130 coins over days 1-30", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 29, 30].map(streakRewardFor), [20, 30, 50, 20, 20, 20, 100, 20, 20, 150, 20, 20, 300]);
  let total = 0;
  for (let d = 1; d <= 30; d++) total += streakRewardFor(d);
  assert.equal(total, 1130);
  // After Day 30: 20 a day, 100 on every 7th, 300 on every 30th.
  assert.deepEqual([31, 35, 42, 60, 90, 61].map(streakRewardFor), [20, 100, 100, 300, 300, 20]);
  assert.equal(streakRewardFor(0), 0);
  assert.deepEqual([3, 7, 14, 30, 35].map(isStreakMilestone), [true, true, true, true, true]);
  assert.deepEqual([1, 2, 4, 31].map(isStreakMilestone), [false, false, false, false]);
});

test("Streak Saves are earned on day 3, then every 7 days", () => {
  assert.deepEqual([3, 10, 17, 24, 31].map(earnsStreakSave), [true, true, true, true, true]);
  assert.deepEqual([1, 2, 4, 7, 14, 30].map(earnsStreakSave), [false, false, false, false, false, false]);
});

test("day arithmetic is calendar-exact (DST cannot skew it)", () => {
  assert.equal(daysBetween("2026-10-24", "2026-10-25"), 1); // Israel DST ends 25 Oct 2026
  assert.equal(daysBetween("2026-03-26", "2026-03-27"), 1);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2026-10-09", "2026-10-09"), 0);
});

test("Day 1: a first completion starts the streak, pays 20 and says what tomorrow brings", () => {
  const r = completeStreakDay(EMPTY_STREAK, "2026-10-10");
  assert.equal(r.advanced, true);
  assert.equal(r.day, 1);
  assert.equal(r.coins, 20);
  assert.deepEqual(r.state, { lastDay: "2026-10-10", current: 1, best: 1, saves: 0, emberGranted: false });
  assert.deepEqual(viewStreak(r.state, "2026-10-10").doneToday, true);
  assert.deepEqual(viewStreak(r.state, "2026-10-11").next, { day: 2, coins: 30 });
});

test("a retry the same day (and a clock that went backwards) changes nothing and pays nothing", () => {
  const s = at("2026-10-10", 4);
  for (const day of ["2026-10-10", "2026-10-09"]) {
    const r = completeStreakDay(s, day);
    assert.equal(r.advanced, false);
    assert.equal(r.coins, 0);
    assert.equal(r.state, s);
  }
});

test("consecutive days advance; Day 3 earns the first Save; the Save cap is 2", () => {
  let s: StreakState = EMPTY_STREAK;
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  for (const d of days) s = completeStreakDay(s, d).state;
  assert.equal(s.current, 3);
  assert.equal(s.saves, 1);
  const full = completeStreakDay(at("2026-10-09", 9, { saves: 2 }), "2026-10-10");
  assert.equal(full.state.saves, 2, "day 10 earns nothing while 2 are held");
  assert.equal(full.saveEarned, false);
});

test("one missed day uses a Save automatically; too few Saves restart at Day 1 but keep the best", () => {
  const saved = completeStreakDay(at("2026-10-08", 5, { saves: 1 }), "2026-10-10");
  assert.equal(saved.day, 6);
  assert.equal(saved.savesUsed, 1);
  assert.equal(saved.state.saves, 0);
  const twoMissed = completeStreakDay(at("2026-10-07", 5, { saves: 2 }), "2026-10-10");
  assert.equal(twoMissed.day, 6, "two Saves cover two missed days");
  assert.equal(twoMissed.state.saves, 0);
  const broken = completeStreakDay(at("2026-10-07", 12, { saves: 1, best: 12 }), "2026-10-10");
  assert.equal(broken.day, 1);
  assert.equal(broken.savesUsed, 0, "Saves are not burned on a streak that cannot be continued");
  assert.equal(broken.state.saves, 1);
  assert.equal(broken.state.best, 12);
  assert.equal(broken.restartedFrom, 12);
  // The view agrees before anything is used: alive with Saves, 0 when it can no longer continue.
  assert.deepEqual([viewStreak(at("2026-10-08", 5, { saves: 1 }), "2026-10-10").current, viewStreak(at("2026-10-07", 12, { saves: 1 }), "2026-10-10").current], [5, 0]);
});

test("Day 30 grants the Ember Ink exactly once", () => {
  const first = completeStreakDay(at("2026-10-09", 29), "2026-10-10");
  assert.equal(first.day, 30);
  assert.equal(first.coins, 300);
  assert.equal(first.emberUnlocked, true);
  const again = completeStreakDay({ ...at("2026-10-09", 59), emberGranted: true }, "2026-10-10");
  assert.equal(again.emberUnlocked, false);
  const later = completeStreakDay(at("2026-10-09", 30, { emberGranted: true }), "2026-10-10");
  assert.equal(later.emberUnlocked, false);
});

test("stored streak values are normalized (older saves have none; edited ones are clamped)", () => {
  assert.deepEqual(normalizeStreak(undefined), EMPTY_STREAK);
  assert.deepEqual(normalizeStreak({ lastDay: "nonsense", current: 9 }), EMPTY_STREAK);
  assert.deepEqual(normalizeStreak({ lastDay: "2026-10-10", current: 4, best: 2, saves: 7, emberGranted: "yes" }), {
    lastDay: "2026-10-10",
    current: 4,
    best: 4,
    saves: 2,
    emberGranted: false,
  });
});

// -------------------------------------------------------------- unlock now ----

const base = { android: true, flagOn: true, usedToday: false, anyLocked: true, price: 1250, coins: 1100 };

test("Unlock Now: only on Android, flag on, unused today, a locked category, and a shortfall of 1-250", () => {
  assert.equal(isUnlockNowEligible(base), true);
  assert.equal(isUnlockNowEligible({ ...base, coins: 1000 }), true, "exactly 250 short");
  assert.equal(isUnlockNowEligible({ ...base, coins: 999 }), false, "251 short");
  assert.equal(isUnlockNowEligible({ ...base, coins: 1250 }), false, "already affordable - buy it normally");
  for (const off of [{ android: false }, { flagOn: false }, { usedToday: true }, { anyLocked: false }]) {
    assert.equal(isUnlockNowEligible({ ...base, ...off }), false, JSON.stringify(off));
  }
});

test("Unlock Now credits exactly the shortfall at grant time, never more than 250, never negative", () => {
  assert.equal(unlockNowCredit(1250, 1100), 150);
  assert.equal(unlockNowCredit(1500, 1000), UNLOCK_NOW_MAX_TOPUP);
  assert.equal(unlockNowCredit(1000, 1200), 0, "balance moved past the price while the ad played");
});

// ---------------------------------------------------------------- x3run ----

test("x3run bonus: 2 x run, capped at +400; a flat +50 when that is under 50 and a minimum is left today", () => {
  assert.deepEqual(runOfferBonus(117, true), { bonus: 234, minApplied: false });
  assert.deepEqual(runOfferBonus(250, true), { bonus: RUN_BONUS_MAX, minApplied: false });
  assert.deepEqual(runOfferBonus(25, true), { bonus: 50, minApplied: false }, "exactly 50 is the x3 itself");
  assert.deepEqual(runOfferBonus(10, true), { bonus: RUN_BONUS_MIN, minApplied: true });
  assert.deepEqual(runOfferBonus(0, true), { bonus: RUN_BONUS_MIN, minApplied: true });
  assert.deepEqual(runOfferBonus(10, false), { bonus: 20, minApplied: false }, "no minimum left: the plain x3");
  assert.deepEqual(runOfferBonus(0, false), { bonus: 0, minApplied: false }, "nothing to offer");
});

test("the run A/B: flag off = everyone x3; flag on = a stable ~50/50 split on its own salt", () => {
  assert.equal(getRewardedArm(false), "x3");
  assert.equal(assignRunArm(null), "x3");
  let run = 0;
  for (let i = 0; i < 4000; i++) {
    const arm = assignRunArm(`install-${i}`);
    assert.equal(arm, assignRunArm(`install-${i}`), "stable");
    if (arm === "x3run") run++;
  }
  assert.ok(run > 1850 && run < 2150, `~50% x3run (got ${run})`);
});

// ------------------------------------------------------------- flag schema ----

test("coin-offer flags: exactly { version, runX3, unlockNow }; anything else is OFF", () => {
  const ok = { version: 1, runX3: true, unlockNow: false };
  assert.equal(isValidStoredCoinOfferConfig(ok), true);
  assert.deepEqual(parseStoredCoinOfferConfig(JSON.stringify(ok)), ok);
  assert.deepEqual(parseClientCoinOfferConfig(ok), ok);
  for (const bad of [null, [], {}, { ...ok, extra: 1 }, { ...ok, version: 0 }, { ...ok, runX3: "true" }, { version: 1, runX3: true }]) {
    assert.equal(isValidStoredCoinOfferConfig(bad), false, JSON.stringify(bad));
    assert.equal(parseClientCoinOfferConfig(bad), null);
  }
  assert.equal(parseStoredCoinOfferConfig("{not json"), null);
});

// --------------------------------------------------------------- analytics ----

const econ = { balanceBucket: "1k_2.5k", baseReward: 117, adAvailable: true, nextTarget: "category", shortfallBucket: "affordable", adClosesGap: false, gamesBucket: "25_49" };
const experiment = { arm: "x3run", offerNumber: 2, sessionGames: 8, bonusCoins: 234, interstitialArm: "treatment" };

test("analytics: x3run offers validate with multiplier 3 (or 1 for the flat minimum); x3 stays strict", () => {
  assert.equal(validateEventParams("reward_offer_shown", { placement: "shape_challenge_double_reward", ...econ, multiplier: 3, ...experiment }).valid, true);
  assert.equal(validateEventParams("reward_ad_completed", { placement: "shape_challenge_double_reward", ...econ, multiplier: 1, ...experiment, bonusCoins: 50 }).valid, true);
  assert.equal(validateEventParams("reward_offer_shown", { placement: "shape_challenge_double_reward", ...econ, multiplier: 2, ...experiment }).valid, false);
  assert.equal(validateEventParams("reward_offer_shown", { placement: "shape_challenge_double_reward", ...econ, multiplier: 1, ...experiment, arm: "x3" }).valid, false);
  assert.equal(validateEventParams("reward_continuation", { arm: "x3run", offerNumber: 1, outcome: "completed" }).valid, true);
});

test("analytics: Unlock Now funnel rows, streak / goal coins, Save purchases and streak milestones all validate", () => {
  for (const ev of ["reward_offer_shown", "reward_ad_started", "reward_ad_completed", "reward_ad_failed"] as const) {
    assert.equal(validateEventParams(ev, { placement: "category_unlock_topup" }).valid, true, ev);
  }
  for (const coinSource of ["daily_streak", "daily_goal"]) {
    assert.equal(validateEventParams("coin_earned", { coinSource, amount: 20, balanceBucket: "100_499" }).valid, true, coinSource);
  }
  assert.equal(validateEventParams("coin_earned", { coinSource: "ad_topup", amount: 20, balanceBucket: "100_499" }).valid, false, "the top-up rides the rewarded funnel");
  const spend = { coinSink: "streak_save", price: 300, balanceBucket: "500_799", gamesBucket: "25_49", playerAgeBucket: "d4_7", spendOrdinal: "first" };
  assert.equal(validateEventParams("coin_spent", spend).valid, true);
  for (const milestone of ["streak_3", "streak_7", "streak_30"]) {
    assert.equal(validateEventParams("progression_milestone", { milestone, categoryOrdinal: 0, balanceBucket: "1k_2.5k", gamesBucket: "50_99", playerAgeBucket: "d8_14" }).valid, true, milestone);
  }
  assert.equal(validateEventParams("coin_spent", { ...spend, price: 1250, coinSink: "category_unlock" }).valid, true, "category prices are range-validated, never an allowlist");
});

test("the QA arm override is inert outside debuggable builds (a Play build can never force an arm)", async () => {
  const { qaForcedRunArm } = await import("../services/ads/coinOfferConfig");
  assert.equal(qaForcedRunArm(), null);
});
