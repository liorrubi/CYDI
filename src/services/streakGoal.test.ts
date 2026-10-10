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
const { buyStreakSave, getStreakRescueOffer, getStreakView, grantStreakRescue, recordDailyCompletion } = await import("./drawingStreakStore.ts");
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

test("Streak Rescue (store): offered on the restart day, granted once, pays nothing; an ad ending after midnight still counts", async () => {
  fresh(0);
  updateSaveData((d) => {
    d.progress.drawingStreak = { lastDay: "2026-10-08", current: 12, best: 12, saves: 0, emberGranted: false };
  });
  assert.equal(getStreakRescueOffer(il("2026-10-10")), null, "nothing before the Daily is completed");
  recordDailyCompletion(il("2026-10-10"));
  assert.equal(getCoins(), 20, "the restart day pays Day 1");
  const offer = getStreakRescueOffer(il("2026-10-10"));
  assert.deepEqual(offer, { from: 12, day: "2026-10-10" });
  const saved = JSON.parse(JSON.stringify(getSaveData()));
  replaceSaveData(saved);
  assert.deepEqual(getStreakRescueOffer(il("2026-10-10")), offer, "survives a reload");
  sent.length = 0;
  // The ad was shown on the 10th and its reward arrives at 00:00:30 Israel time on the 11th.
  assert.equal(grantStreakRescue(offer!.day), true);
  assert.equal(grantStreakRescue(offer!.day), false, "a duplicate reward callback changes nothing");
  assert.equal(getCoins(), 20, "no coins");
  assert.equal(getStreakView(Date.parse("2026-10-10T21:00:30Z")).current, 13);
  assert.equal(recordDailyCompletion(il("2026-10-11")).day, 14, "continues the next day");
  await flush();
  assert.equal(sent.filter((x) => x.name === "coin_earned").length, 1, "only the next day's streak coins");
});

test("Streak Rescue: the only grant call is behind a verified ad reward (call-site audit)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && fs.readFileSync(f, "utf8").includes("grantStreakRescue(")) {
        callers.push(path.relative(root, f).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  assert.deepEqual(callers.sort(), ["components/StreakRescueOffer.tsx", "services/drawingStreakStore.ts"]);
  const src = fs.readFileSync(path.join(root, "components/StreakRescueOffer.tsx"), "utf8");
  const grant = src.indexOf("grantStreakRescue(offer.day)");
  const gate = src.lastIndexOf('outcome.grantSource === "ad"', grant);
  assert.ok(gate > 0 && grant - gate < 200, "granted only inside the verified-reward branch");
  for (const gateFn of ["isAndroidApp()", "isStreakRescueOn()", 'isRewardedAdReadyFor("streak_rescue")']) assert.ok(src.includes(gateFn), gateFn);
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

// ------------------------------------------------- 0.59.0 existing-player migration ----

test("migration: a 0.58 save (no streak / goal / ad-limit fields) loads and reads without a single write", () => {
  fresh(0);
  updateSaveData((d) => {
    d.progress.coins = 4321;
    d.progress.unlockedCategories = ["geometric", "symbols", "alphabet"];
    d.progress.achievements = ["first-steps", "explorer"];
    d.progress.unlockedPenColors = ["purple", "rainbow"];
    d.progress.shapeChallenge.bestScores = { circle: 91, square: 77 };
    d.progress.dailyStreak = { lastVisitDate: "2026-10-08", currentStreak: 4, longestStreak: 9 };
    delete (d.progress as Record<string, unknown>).drawingStreak;
    delete (d.progress as Record<string, unknown>).dailyGoal;
    delete (d.progress as Record<string, unknown>).adLimits;
  });
  const before = JSON.stringify(getSaveData());
  // Every 0.59.0 read path a returning player hits on launch / Home / Daily / map / Shop / result.
  assert.equal(getStreakView(il("2026-10-10")).current, 0);
  assert.deepEqual(getDailyGoal(), { games: 0, target: 5, claimed: false });
  assert.equal(getPaidCategoryPurchaseCount(), 2);
  assert.equal(nextCategoryUnlockPrice(), 1500, "two paid categories bought -> the 3rd costs 1,500");
  assert.equal(isUnlockNowUsedToday(), false);
  assert.equal(hasRunMinBonusLeftToday(), true);
  assert.equal(isColorUnlocked("rainbow"), true, "an ink bought at the old 10,000 stays owned");
  assert.equal(JSON.stringify(getSaveData()), before, "coins, categories, achievements, inks, progress and the visit streak are untouched");
});

test("migration: purchase order counts only real paid purchases - ambiguous legacy history never raises the price", () => {
  const priceFor = (list: string[]) => {
    fresh(0);
    updateSaveData((d) => {
      d.progress.unlockedCategories = list;
    });
    return [getPaidCategoryPurchaseCount(), nextCategoryUnlockPrice()];
  };
  assert.deepEqual(priceFor([]), [0, 1000]);
  assert.deepEqual(priceFor(["geometric"]), [0, 1000], "the always-free first category is not a purchase");
  assert.deepEqual(priceFor(["symbols"]), [1, 1250]);
  assert.deepEqual(priceFor(["geometric", "symbols", "symbols"]), [1, 1250], "a duplicate from an old import counts once");
  assert.deepEqual(priceFor(["symbols", "retired-category", "???"]), [1, 1250], "unknown / retired ids are ignored");
  assert.deepEqual(priceFor(["symbols", "alphabet", "home", "food"]), [4, 1500]);
});

test("migration: a category open only through pre-paywall play (progress, not purchase) is free and not counted", () => {
  fresh(0);
  updateSaveData((d) => {
    d.progress.unlockedCategories = [];
    d.progress.shapeChallenge.completedShapeIdsByCategory = { symbols: ["heart"] };
  });
  assert.equal(getPaidCategoryPurchaseCount(), 0);
  assert.equal(nextCategoryUnlockPrice(), 1000);
});
