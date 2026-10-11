// 0.59.0 - the REAL stores against an in-memory localStorage: the Daily Drawing Streak (pays once a day, Ember once,
// Save purchase, 5 finished drawings in any mix of modes), category purchase order (price + analytics ordinal
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
const { addCoins, getCoins } = await import("./coinsStore.ts");
const { buyStreakSave, getStreakRescueOffer, getStreakView, grantStreakRescue, onStreakDayCompleted, recordStreakActivity } = await import(
  "./drawingStreakStore.ts"
);
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
/** Five finished Daily drawings at `now` - what makes a day count. Returns the completion they made, if any. */
const fiveDrawings = (now: number) => {
  let made = null;
  for (let i = 0; i < 5; i++) made = recordStreakActivity("daily", { now }).completion ?? made;
  return made;
};

test("streak: the first completion of a day pays its coins once; a retry the same day pays nothing", async () => {
  fresh(0);
  const first = fiveDrawings(il("2026-10-10"));
  assert.equal(first?.day, 1);
  assert.equal(getCoins(), 20);
  const retry = fiveDrawings(il("2026-10-10") + 3_600_000);
  assert.equal(retry, null);
  assert.equal(getCoins(), 20, "no second payment");
  await flush();
  const earned = sent.filter((s) => s.name === "coin_earned").map((s) => s.params);
  assert.deepEqual(earned, [{ coinSource: "daily_streak", amount: 20, balanceBucket: "0_99", streakDay: "1", streakRoute: "daily" }]);
});

test("streak: survives a reload (it lives in the save) and continues the next Israel day", () => {
  fresh(0);
  fiveDrawings(il("2026-10-10"));
  const saved = JSON.parse(JSON.stringify(getSaveData()));
  replaceSaveData(saved);
  const next = fiveDrawings(il("2026-10-11"));
  assert.equal(next?.day, 2);
  assert.equal(getCoins(), 50);
  assert.equal(getStreakView(il("2026-10-11")).doneToday, true);
});

test("streak: the Israel day decides, not the device's - 23:30 UTC on the 10th is already the 11th in Israel", () => {
  fresh(0);
  fiveDrawings(Date.parse("2026-10-10T08:00:00Z"));
  const lateUtc = fiveDrawings(Date.parse("2026-10-10T23:30:00Z")); // 02:30 on the 11th in Israel (UTC+3)
  assert.equal(lateUtc?.day, 2);
});

test("streak: Day 3 milestone is reported once per player; Day 30 grants the Ember Ink", async () => {
  fresh(0);
  for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) fiveDrawings(il(d));
  await flush();
  assert.deepEqual(sent.filter((s) => s.name === "progression_milestone").map((s) => s.params.milestone), ["streak_3"]);
  updateSaveData((d) => {
    d.progress.drawingStreak = { lastDay: "2026-10-20", current: 29, best: 29, saves: 0, emberGranted: false };
  });
  assert.equal(isColorUnlocked("ember"), false);
  const day30 = fiveDrawings(il("2026-10-21"));
  assert.equal(day30?.emberUnlocked, true);
  assert.equal(isColorUnlocked("ember"), true);
  // The streak achievements were paid the moment their day counted (Daily drawings here - not on a later Classic visit).
  assert.deepEqual(getSaveData().progress.achievements.filter((id) => id.startsWith("streak-")).sort(), ["streak-14", "streak-3", "streak-30", "streak-7"]);
  // This run crossed 1,000 coins; let the client's 2 s duplicate-event window pass so a later test's identical
  // milestone is not dropped as a repeat of this one.
  await new Promise((r) => setTimeout(r, 2100));
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
    d.progress.achievements = ["streak-3", "streak-7"]; // paid when that 12-day streak reached them
  });
  assert.deepEqual(getStreakRescueOffer(il("2026-10-10")), { from: 12, day: "2026-10-10" }, "available before today counts too");
  fiveDrawings(il("2026-10-10"));
  assert.equal(getCoins(), 20, "the restart day pays Day 1");
  const offer = getStreakRescueOffer(il("2026-10-10"));
  assert.deepEqual(offer, { from: 12, day: "2026-10-10" });
  const saved = JSON.parse(JSON.stringify(getSaveData()));
  replaceSaveData(saved);
  assert.deepEqual(getStreakRescueOffer(il("2026-10-10")), offer, "survives a reload");
  sent.length = 0;
  // The ad was shown on the 10th and its reward arrives at 00:00:30 Israel time on the 11th.
  assert.deepEqual(grantStreakRescue(offer!.day), { achievements: [], megaCards: [] }, "kept; 13 reaches no streak achievement");
  assert.equal(grantStreakRescue(offer!.day), null, "a duplicate reward callback changes nothing");
  assert.equal(getCoins(), 20, "no coins");
  assert.equal(getStreakView(Date.parse("2026-10-10T21:00:30Z")).current, 13);
  assert.equal(fiveDrawings(il("2026-10-11"))?.day, 14, "continues the next day");
  assert.equal(getCoins(), 20 + 150 + 500, "Day 14 pays its milestone and, the same moment, the 14-Day Streak achievement");
  await flush();
  assert.deepEqual(sent.filter((x) => x.name === "coin_earned").map((x) => x.params.coinSource).sort(), ["achievement", "daily_streak"], "the rescue itself paid nothing");
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
  assert.deepEqual(callers.sort(), ["hooks/useStreakRescue.ts", "services/drawingStreakStore.ts"]);
  const src = fs.readFileSync(path.join(root, "hooks/useStreakRescue.ts"), "utf8");
  const grant = src.indexOf("grantStreakRescue(offer.day)");
  const gate = src.lastIndexOf('outcome.grantSource === "ad"', grant);
  assert.ok(gate > 0 && grant - gate < 200, "granted only inside the verified-reward branch");
  for (const gateFn of ["isAndroidApp()", "isStreakRescueOn()", 'isRewardedAdReadyFor("streak_rescue")']) assert.ok(src.includes(gateFn), gateFn);
});

test("Streak Rescue (store) before today counts: the missed day is bridged, then today's drawings pay Day 13", () => {
  fresh(0);
  updateSaveData((d) => {
    d.progress.drawingStreak = { lastDay: "2026-10-08", current: 12, best: 12, saves: 0, emberGranted: false };
    d.progress.achievements = ["streak-3", "streak-7"]; // paid when that 12-day streak reached them
  });
  assert.deepEqual([getStreakView(il("2026-10-10")).status, getStreakView(il("2026-10-10")).current], ["at_risk", 12]);
  assert.ok(grantStreakRescue("2026-10-10", il("2026-10-10")));
  assert.equal(getCoins(), 0, "the rescue pays nothing");
  assert.equal(getStreakView(il("2026-10-10")).status, "rescued");
  let day = null;
  for (let i = 0; i < 5; i++) day = recordStreakActivity("multiplayer", { now: il("2026-10-10") }).completion ?? day;
  assert.equal(day?.day, 13);
  assert.equal(getCoins(), 20);
});

test("activity streak (store): mixed modes reach 5 drawings; one payment with route + day bucket; the day event fires once", async () => {
  fresh(0);
  const events: string[] = [];
  const listeners: ((e: Event) => void)[] = [];
  const w = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
  const prevAdd = w.addEventListener;
  const prevDispatch = w.dispatchEvent;
  w.addEventListener = (name: string, fn: (e: Event) => void) => void (name === "cydi:streak-day" && listeners.push(fn));
  w.dispatchEvent = (e: Event) => (e.type === "cydi:streak-day" && listeners.forEach((fn) => fn(e)), true);
  try {
    onStreakDayCompleted((d) => events.push(`${d.route}:${d.completion.day}`));
    const routes = ["classic", "classic", "multiplayer", "two_players", "other", "classic", "multiplayer"] as const;
    const days = routes.map((r) => recordStreakActivity(r, { now: il("2026-10-10") }).completion?.day ?? null);
    assert.deepEqual(days, [null, null, null, null, 1, null, null]);
    assert.equal(recordStreakActivity("daily", { now: il("2026-10-10") }).completion, null, "a Daily drawing on a day that already counts pays nothing");
  } finally {
    w.addEventListener = prevAdd;
    w.dispatchEvent = prevDispatch;
  }
  assert.deepEqual(events, ["other:1"], "the 5th drawing (a Special/Mega/Artist/custom one here) completed the day");
  assert.equal(getCoins(), 20);
  await flush();
  assert.deepEqual(
    sent.filter((s) => s.name === "coin_earned").map((s) => s.params),
    [{ coinSource: "daily_streak", amount: 20, balanceBucket: "0_99", streakDay: "1", streakRoute: "other" }],
  );
  assert.equal(getStreakView(il("2026-10-10")).drawings, 8, "the Daily drawing counted as one more, nothing paid");
  assert.equal(getStreakView(il("2026-10-11")).drawings, 0, "a new Israel day starts from 0");
});

test("activity streak (store): opening the app or a practice replay records nothing - only the mode hooks call it", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const text = fs.readFileSync(f, "utf8");
        const n = (text.match(/recordStreakActivity\(/g) ?? []).length - (text.includes("export function recordStreakActivity(") ? 1 : 0);
        if (n > 0) callers.push(`${path.relative(root, f).split(path.sep).join("/")}:${n}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(callers.sort(), [
    "components/multiplayer/PlayTogetherRoom.tsx:1",
    "components/passplay/PassPlayGame.tsx:1",
    "screens/ArtistPackScreen.tsx:1",
    "screens/DailyChallengeScreen.tsx:1",
    "screens/MegaChallengeScreen.tsx:1",
    "screens/ShapeChallengeScreen.tsx:1",
    "screens/SpecialChallengeScreen.tsx:1",
  ]);
  const classic = fs.readFileSync(path.join(root, "screens/ShapeChallengeScreen.tsx"), "utf8");
  const call = classic.indexOf('recordStreakActivity("classic")');
  assert.ok(classic.lastIndexOf("if (!practice) {", call) > call - 300, "Classic counts every round except web landing-page practice");
  const mp = fs.readFileSync(path.join(root, "components/multiplayer/PlayTogetherRoom.tsx"), "utf8");
  const mpCall = mp.indexOf('recordStreakActivity("multiplayer", { key:');
  assert.ok(mpCall > 0 && mp.lastIndexOf("if (snapshot.you?.submitted && drewRoundsRef.current.has(snapshot.roundIndex)) {", mpCall) > mpCall - 160, "only rounds this device actually drew in (not the 0s empty auto-submit), keyed per round");
  assert.ok(mp.includes("if (drawn) drewRoundsRef.current.add(snapshot.roundIndex);"), "a round is marked drawn only when a real drawing is submitted");
  const pp = fs.readFileSync(path.join(root, "components/passplay/PassPlayGame.tsx"), "utf8");
  assert.ok(pp.includes('if (emptyTurnsRef.current === 0) recordStreakActivity("two_players", { key:'), "2 Players: a round everyone drew in, keyed per round");
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
    delete (d.progress as Record<string, unknown>).adLimits;
  });
  const before = JSON.stringify(getSaveData());
  // Every 0.59.0 read path a returning player hits on launch / Home / Daily / map / Shop / result.
  assert.equal(getStreakView(il("2026-10-10")).current, 0);
  assert.equal(getStreakView(il("2026-10-10")).drawings, 0);
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

test("QA fix: a streak day the player's best had already passed (restart, restored backup) is not a first-time milestone", async () => {
  fresh(0);
  updateSaveData((d) => {
    d.progress.drawingStreak = { lastDay: "2026-10-09", current: 2, best: 12, saves: 0, emberGranted: false };
  });
  for (let i = 0; i < 5; i++) recordStreakActivity("classic", { now: il("2026-10-10") });
  assert.equal(getStreakView(il("2026-10-10")).current, 3);
  await flush();
  assert.deepEqual(sent.filter((s) => s.name === "progression_milestone").map((s) => s.params.milestone), [], "best 12 already passed day 3");
});

test("QA fix: an Unlock Now top-up that lifts the balance past 1,000 for an instant is not a balance_1k milestone", async () => {
  fresh(899);
  addCoins(1, "achievement"); // starts tracking below 1,000 (a balance already held at first sight is not a milestone)
  addCoins(150, "ad_topup");
  await flush();
  assert.deepEqual(sent.filter((s) => s.name === "progression_milestone").map((s) => s.params.milestone), []);
  addCoins(200, "achievement");
  await flush();
  assert.deepEqual(sent.filter((s) => s.name === "progression_milestone").map((s) => s.params.milestone), ["balance_1k_reached"], "a real credit still reports it");
});
