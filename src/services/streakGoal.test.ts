// 0.59.0 - the REAL stores against an in-memory localStorage: the Daily Drawing Streak (pays once a day, Ember once,
// Save purchase), the daily goal (pays once a day, never twice), category purchase order (price + analytics ordinal
// from one count) and the per-day Rewarded limits. Captures what trackEvent would send.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, setTimeout, clearTimeout };
store.set("cydi.analyticsDebug.v1", "1");

const { registerAnalyticsProvider } = await import("./analytics.ts");
const { validateEventParams } = await import("./analyticsSchema.ts");
const { getSaveData, updateSaveData, replaceSaveData } = await import("./saveStore.ts");
const { createDefaultSaveData } = await import("./saveData.ts");
const { getCoins } = await import("./coinsStore.ts");
const { buyStreakSave, getStreakView, recordDailyCompletion } = await import("./drawingStreakStore.ts");
const { getDailyGoal, recordDailyGoalGame } = await import("./dailyGoalStore.ts");
const { getPaidCategoryPurchaseCount, nextCategoryUnlockPrice, unlockCategory } = await import("./categoryUnlockStore.ts");
const { hasRunMinBonusLeftToday, isUnlockNowUsedToday, recordRunMinBonusGranted, recordUnlockNowUsed } = await import("./adDailyLimitsStore.ts");
const { isColorUnlocked } = await import("./penColorStore.ts");
const { _resetEconomyAnalyticsForTests } = await import("./economyAnalytics.ts");

type Sent = { name: string; params: Record<string, unknown> };
const sent: Sent[] = [];
const everySent: Sent[] = [];
registerAnalyticsProvider({
  name: "test-capture",
  trackEvent: (name: string, params: unknown) => {
    sent.push({ name, params: params as Record<string, unknown> });
    everySent.push({ name, params: params as Record<string, unknown> });
  },
} as never);
const flush = () => new Promise((r) => setTimeout(r, 5));

function fresh(coins = 0) {
  for (const k of [...store.keys()]) if (k !== "cydi.analyticsDebug.v1") store.delete(k);
  replaceSaveData(createDefaultSaveData());
  updateSaveData((d) => {
    d.progress.coins = coins;
  });
  _resetEconomyAnalyticsForTests();
  sent.length = 0;
}

// Israel noon on the given date - the streak's day is the Israel calendar day.
const il = (date: string) => Date.parse(`${date}T09:00:00Z`);

test("streak: the first completion of a day pays its coins once; a retry the same day pays nothing", async () => {
  fresh(0);
  const first = recordDailyCompletion(il("2026-10-10"));
  assert.equal(first.advanced, true);
  assert.equal(getCoins(), 20);
  const retry = recordDailyCompletion(il("2026-10-10") + 3_600_000);
  assert.equal(retry.advanced, false);
  assert.equal(getCoins(), 20, "no second payment");
  await flush();
  const earned = sent.filter((s) => s.name === "coin_earned").map((s) => s.params);
  assert.deepEqual(earned, [{ coinSource: "daily_streak", amount: 20, balanceBucket: "0_99" }]);
});

test("streak: survives a reload (it lives in the save) and continues the next Israel day", () => {
  fresh(0);
  recordDailyCompletion(il("2026-10-10"));
  const saved = JSON.parse(JSON.stringify(getSaveData()));
  replaceSaveData(saved);
  const next = recordDailyCompletion(il("2026-10-11"));
  assert.equal(next.day, 2);
  assert.equal(getCoins(), 50);
  assert.equal(getStreakView(il("2026-10-11")).doneToday, true);
});

test("streak: the Israel day decides, not the device's - 23:30 UTC on the 10th is already the 11th in Israel", () => {
  fresh(0);
  recordDailyCompletion(Date.parse("2026-10-10T08:00:00Z"));
  const lateUtc = recordDailyCompletion(Date.parse("2026-10-10T23:30:00Z")); // 02:30 on the 11th in Israel (UTC+3)
  assert.equal(lateUtc.advanced, true);
  assert.equal(lateUtc.day, 2);
});

test("streak: Day 3 milestone is reported once per player; Day 30 grants the Ember Ink", async () => {
  fresh(0);
  for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) recordDailyCompletion(il(d));
  await flush();
  assert.deepEqual(sent.filter((s) => s.name === "progression_milestone").map((s) => s.params.milestone), ["streak_3"]);
  updateSaveData((d) => {
    d.progress.drawingStreak = { lastDay: "2026-10-20", current: 29, best: 29, saves: 0, emberGranted: false };
  });
  assert.equal(isColorUnlocked("ember"), false);
  const day30 = recordDailyCompletion(il("2026-10-21"));
  assert.equal(day30.emberUnlocked, true);
  assert.equal(isColorUnlocked("ember"), true);
});

test("Streak Save: 300 coins, at most 2 held, never spends on failure", () => {
  fresh(650);
  assert.equal(buyStreakSave(), "bought");
  assert.equal(buyStreakSave(), "bought");
  assert.equal(getCoins(), 50);
  assert.equal(buyStreakSave(), "full");
  fresh(299);
  assert.equal(buyStreakSave(), "insufficient_coins");
  assert.equal(getCoins(), 299);
  assert.equal(getStreakView().saves, 0);
});

test("daily goal: 5 Classic games pay +20 exactly once that day; progress counts on", async () => {
  fresh(0);
  const results = Array.from({ length: 7 }, () => recordDailyGoalGame());
  assert.deepEqual(results.map((r) => r.justCompleted), [false, false, false, false, true, false, false]);
  assert.equal(getCoins(), 20);
  assert.equal(getDailyGoal().claimed, true);
  await flush();
  assert.deepEqual(sent.filter((s) => s.name === "coin_earned").map((s) => s.params.coinSource), ["daily_goal"]);
});

test("daily goal: a stored previous day reads as a fresh 0/5", () => {
  fresh(0);
  updateSaveData((d) => {
    d.progress.dailyGoal = { date: "2020-01-01", games: 5, claimed: true };
  });
  assert.deepEqual(getDailyGoal(), { games: 0, target: 5, claimed: false });
});

test("category purchase order: one count drives the price (1,000 / 1,250 / 1,500) and the analytics ordinal", () => {
  fresh(0);
  assert.equal(getPaidCategoryPurchaseCount(), 0);
  assert.equal(nextCategoryUnlockPrice(), 1000);
  unlockCategory("symbols" as never);
  assert.equal(nextCategoryUnlockPrice(), 1250);
  unlockCategory("alphabet" as never);
  unlockCategory("home" as never);
  assert.equal(getPaidCategoryPurchaseCount(), 3);
  assert.equal(nextCategoryUnlockPrice(), 1500);
  // The always-free first category is never counted, even when it is in the saved list.
  updateSaveData((d) => {
    d.progress.unlockedCategories = ["geometric", "symbols"];
  });
  assert.equal(getPaidCategoryPurchaseCount(), 1);
});

test("per-day Rewarded limits: Unlock Now once a day, x3run minimum 3 a day", () => {
  fresh(0);
  assert.equal(isUnlockNowUsedToday(), false);
  recordUnlockNowUsed();
  assert.equal(isUnlockNowUsedToday(), true);
  for (let i = 0; i < 3; i++) {
    assert.equal(hasRunMinBonusLeftToday(), true);
    recordRunMinBonusGranted();
  }
  assert.equal(hasRunMinBonusLeftToday(), false);
  updateSaveData((d) => {
    d.progress.adLimits = { date: "2020-01-01", unlockNowUsed: true, minBonusGrants: 3 };
  });
  assert.equal(isUnlockNowUsedToday(), false, "a new day resets both");
  assert.equal(hasRunMinBonusLeftToday(), true);
});

test("every analytics row this file produced passes the shared validator (the Worker's ingest rule)", async () => {
  await flush();
  assert.ok(everySent.length > 0);
  for (const { name, params } of everySent) assert.equal(validateEventParams(name as never, params).valid, true, `${name} ${JSON.stringify(params)}`);
});
