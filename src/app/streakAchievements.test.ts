// 0.59.0 - the visit streak is retired; the five streak achievements now follow the Drawing Streak, with the frozen
// pre-0.59 visit best as a progress floor: max(legacyVisitBest, drawingStreakBest). Real stores, in-memory storage.
// Also: the celebration-card gate that keeps a covered Rewarded offer from counting as shown, and Back over a card.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
// A real event target, so the streak store's day event (what the celebration shows) can be observed.
const bus = new EventTarget();
(globalThis as Record<string, unknown>).window = {
  addEventListener: bus.addEventListener.bind(bus),
  removeEventListener: bus.removeEventListener.bind(bus),
  dispatchEvent: bus.dispatchEvent.bind(bus),
  setTimeout,
  clearTimeout,
};

const { getSaveData, updateSaveData, replaceSaveData } = await import("../services/saveStore.ts");
const { createDefaultSaveData } = await import("../services/saveData.ts");
const { getCoins } = await import("../services/coinsStore.ts");
const { getStreakView, grantStreakRescue, onStreakDayCompleted, recordStreakActivity } = await import("../services/drawingStreakStore.ts");
const { getLegacyVisitStreakBest } = await import("../services/dailyStreakStore.ts");
const { ACHIEVEMENTS, computeAchievementStats, findNewlyUnlockedAchievements } = await import("./achievements.ts");
const { getProgress } = await import("../services/shapeChallengeProgress.ts");
const { getUnlockedAchievementIds, markAchievementUnlocked } = await import("../services/achievementsStore.ts");
const { syncAchievementCardUnlocks, getMegaProgress } = await import("../services/megaChallengeStore.ts");
const { addToStreakCard, closeStreakCard, getStreakCardExtras, isStreakCardOpen, onStreakCardExtras, openStreakCard, whenStreakCardClosed } = await import("./streakCardGate.ts");
const { clearNavigationGuard, registerNavigationGuard, runNavigationGuard } = await import("./navigationGuard.ts");

const STREAK_IDS = ["streak-3", "streak-7", "streak-14", "streak-30", "streak-100"];
const il = (date: string) => Date.parse(`${date}T09:00:00Z`);
const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function fresh(visitBest: number | null, drawing?: { lastDay: string; current: number; best: number }) {
  store.clear();
  replaceSaveData(createDefaultSaveData());
  updateSaveData((d) => {
    if (visitBest !== null) d.progress.dailyStreak = { lastVisitDate: "2026-10-09", currentStreak: Math.min(visitBest, 4), longestStreak: visitBest };
    if (drawing) d.progress.drawingStreak = { ...drawing, saves: 0, emberGranted: false };
  });
}
const streakStat = () => computeAchievementStats(getProgress()).bestStreak;
const newStreakIds = () => findNewlyUnlockedAchievements(computeAchievementStats(getProgress()), getUnlockedAchievementIds()).map((a) => a.id).filter((id) => STREAK_IDS.includes(id));

test("the five streak achievements keep their ids, thresholds and coins - only the wording now names the Drawing Streak", () => {
  const rows = ACHIEVEMENTS.filter((a) => STREAK_IDS.includes(a.id)).map((a) => [a.id, a.target, a.coinReward]);
  assert.deepEqual(rows, [["streak-3", 3, 100], ["streak-7", 7, 250], ["streak-14", 14, 500], ["streak-30", 30, 1200], ["streak-100", 100, 5000]]);
  for (const a of ACHIEVEMENTS.filter((x) => STREAK_IDS.includes(x.id))) {
    assert.match(a.description, /Drawing Streak/);
    assert.equal(a.name, `${a.target}-Day Streak`, "distinct names that say the day count");
    assert.doesNotMatch(`${a.name} ${a.description}`, /visit/i);
  }
});

test("legacy floor: a 0.58 visit best of 9 keeps 9/14 progress and still qualifies 3 and 7 - with no Drawing Streak at all", () => {
  fresh(9);
  assert.equal(getLegacyVisitStreakBest(), 9);
  assert.equal(streakStat(), 9);
  assert.deepEqual(newStreakIds(), ["streak-3", "streak-7"], "earned before but never banked (Classic not opened since) -> still owed, once");
});

test("earned achievements are never re-awarded, and progress never goes backwards", () => {
  fresh(20, { lastDay: "2026-10-10", current: 2, best: 2 });
  for (const id of ["streak-3", "streak-7", "streak-14"]) markAchievementUnlocked(id);
  assert.equal(streakStat(), 20, "a smaller Drawing Streak never lowers the floor");
  assert.deepEqual(newStreakIds(), []);
  markAchievementUnlocked("streak-7");
  assert.deepEqual(getUnlockedAchievementIds().filter((id) => id === "streak-7"), ["streak-7"], "marking twice changes nothing");
});

test("future progress comes only from the Drawing Streak best", () => {
  fresh(9, { lastDay: "2026-10-10", current: 14, best: 14 });
  markAchievementUnlocked("streak-3");
  markAchievementUnlocked("streak-7");
  assert.equal(streakStat(), 14);
  assert.deepEqual(newStreakIds(), ["streak-14"]);
  fresh(0, { lastDay: "2026-10-10", current: 3, best: 31 });
  assert.equal(streakStat(), 31, "a new player: the Drawing Streak best alone (a broken streak keeps its best)");
  assert.deepEqual(newStreakIds(), ["streak-3", "streak-7", "streak-14", "streak-30"]);
});

test("a missing or malformed visit record reads as 0 and never throws", () => {
  for (const bad of [undefined, { longestStreak: Number.NaN }, { longestStreak: -4 }, { longestStreak: "12" as unknown as number }]) {
    store.clear();
    replaceSaveData(createDefaultSaveData());
    updateSaveData((d) => {
      (d.progress as Record<string, unknown>).dailyStreak = bad === undefined ? undefined : { lastVisitDate: "", currentStreak: 0, ...bad };
    });
    const expected = typeof bad?.longestStreak === "string" ? 12 : 0;
    assert.equal(getLegacyVisitStreakBest(), expected);
    assert.equal(streakStat(), expected);
  }
});

test("the legacy record never counts as Drawing Streak days, coins, Saves or a Rescue - and is never written again", () => {
  fresh(25);
  const visitBefore = JSON.stringify(getSaveData().progress.dailyStreak);
  const view = getStreakView(il("2026-10-11"));
  assert.equal(view.current, 0);
  assert.equal(view.saves, 0);
  assert.equal(view.status, "new");
  let completion = null;
  for (let i = 0; i < 5; i++) completion = recordStreakActivity("classic", { now: il("2026-10-11") }).completion ?? completion;
  assert.equal(completion?.day, 1, "the first counted day is Day 1, not Day 26");
  assert.equal(getCoins(), 20, "Day 1 pays 20 - nothing for the legacy days");
  assert.equal(JSON.stringify(getSaveData().progress.dailyStreak), visitBefore, "the visit record is frozen");
  // Nothing in the app records visits any more.
  assert.doesNotMatch(src("../App.tsx"), /recordDailyVisit/);
  assert.doesNotMatch(src("../services/dailyStreakStore.ts"), /updateSaveData|recordDailyVisit/);
  assert.doesNotMatch(src("../site/SiteHome.tsx"), /dailyStreakStore|getCurrentStreak/, "the web home shows the Drawing Streak only");
});

test("Mega cards linked to streak achievements unlock once, through the same achievement ids", () => {
  fresh(0, { lastDay: "2026-10-10", current: 7, best: 7 });
  for (const a of findNewlyUnlockedAchievements(computeAchievementStats(getProgress()), getUnlockedAchievementIds())) markAchievementUnlocked(a.id);
  assert.ok(getUnlockedAchievementIds().includes("streak-7"));
  const first = syncAchievementCardUnlocks().map((c) => c.id);
  assert.ok(first.includes("mega-sword"), "streak-7 -> Legendary Sword");
  assert.ok(!first.includes("mega-chest"), "streak-14 not reached -> Treasure Chest stays locked");
  assert.deepEqual(syncAchievementCardUnlocks(), [], "a second sync unlocks nothing again");
  assert.equal(getMegaProgress().unlockedCardIds.filter((id) => id === "mega-sword").length, 1);
});

test("streak card gate: an offer counts as shown only once the card covering it is closed, and only once", () => {
  const calls: string[] = [];
  whenStreakCardClosed(() => calls.push("now"));
  assert.deepEqual(calls, ["now"], "no card -> immediately");
  openStreakCard();
  assert.equal(isStreakCardOpen(), true);
  whenStreakCardClosed(() => calls.push("coin"));
  const cancel = whenStreakCardClosed(() => calls.push("left-before-close"));
  cancel();
  assert.deepEqual(calls, ["now"], "nothing while the card is open");
  closeStreakCard();
  closeStreakCard();
  assert.deepEqual(calls, ["now", "coin"], "after close: once; a cancelled (unmounted) offer never reports");
  assert.equal(isStreakCardOpen(), false);
});

test("every Rewarded offer on a result waits for the card; the card opens in the paying tick and Back closes it", () => {
  for (const f of ["../components/DoubleCoinsOffer.tsx", "../components/InkTrialOffer.tsx", "../components/InkTrialCta.tsx"]) {
    const s = src(f);
    assert.match(s, /cancelShown = whenStreakCardClosed\(\(\) => \{\s*\n\s*shownRef\.current = true;/, `${f}: shown only through the gate`);
    assert.match(s, /cancelShown\(\);/, `${f}: an unmount cancels a pending shown`);
  }
  assert.match(src("../components/DoubleCoinsOffer.tsx"), /if \(!shownRef\.current\) return;/, "no skip event for an offer never shown");
  const cel = src("../components/StreakCelebration.tsx");
  assert.match(cel, /onStreakDayCompleted\(\(d\) => \{[\s\S]*?if \(card\) openStreakCard\(\);/);
  assert.match(cel, /closeStreakCard\(\);/);
  assert.match(cel, /registerNavigationGuard\(\(\) => \{\s*\n\s*close\(\);\s*\n\s*return true;/);
});

test("an overlay's Back guard hands the screen's own guard back when it closes", () => {
  clearNavigationGuard();
  const seen: string[] = [];
  const offScreen = registerNavigationGuard(() => (seen.push("room"), true));
  const offCard = registerNavigationGuard(() => (seen.push("card"), true));
  assert.equal(runNavigationGuard(), true);
  offCard();
  assert.equal(runNavigationGuard(), true);
  assert.deepEqual(seen, ["card", "room"]);
  offScreen();
  assert.equal(runNavigationGuard(), false);
});

test("an achievement earned on the drawing that opened a streak card joins that card - one celebration, every reward", () => {
  closeStreakCard();
  assert.equal(addToStreakCard([{ id: "perfect-x3", title: "Perfect x3", coins: 150 }]), false, "no card: the caller shows its own overlay");
  assert.deepEqual(getStreakCardExtras(), []);
  openStreakCard();
  let notified = 0;
  const off = onStreakCardExtras(() => notified++);
  assert.equal(addToStreakCard([{ id: "perfect-x3", title: "Perfect x3", coins: 150 }]), true);
  addToStreakCard([{ id: "perfect-x3", title: "Perfect x3", coins: 150 }, { id: "precision", title: "Precision", coins: 250 }]);
  assert.deepEqual(getStreakCardExtras().map((x) => x.id), ["perfect-x3", "precision"], "each achievement listed once");
  assert.equal(notified, 2);
  const revealed: string[] = [];
  whenStreakCardClosed(() => revealed.push("coins"));
  closeStreakCard();
  assert.deepEqual(revealed, ["coins"], "the counter reveal happens when the card closes");
  assert.deepEqual(getStreakCardExtras(), [], "a later card starts empty");
  off();
});

test("Classic hands same-drawing achievements to the open card and shows no second overlay or fanfare", () => {
  const s = src("../screens/ShapeChallengeScreen.tsx").replace(/\r\n/g, "\n");
  const has = (needle: string) => assert.ok(s.includes(needle), `ShapeChallengeScreen: ${needle}`);
  has("if (!addToStreakCard(pendingAchievements.map((a) => ({ id: a.id, title: a.name, coins: a.coinReward })))) return;\n    whenStreakCardClosed(revealPendingCoins);\n    setPendingAchievements([]);");
  has("const achievementBanner = pendingAchievements[0] && !isStreakCardOpen() &&");
  has("if (pendingAchievements.length > 0 && !isStreakCardOpen()) playAchievementUnlockedSound();");
  // Coins are still banked at detection (never through the card), so nothing can pay twice.
  has("return bankNewAchievements(progress, { pending: true });");
  const cel = src("../components/StreakCelebration.tsx");
  assert.ok(cel.includes("onStreakCardExtras("));
  assert.ok(cel.includes("Achievement: {x.title}"));
});

// ---------------------------------------------- 0.59.0: streak achievements are paid the moment the day counts ----

type DayDetail = Parameters<Parameters<typeof onStreakDayCompleted>[0]>[0];
function completeDay(route: "classic" | "daily" | "other" | "two_players" | "multiplayer", date: string, keyPrefix?: string): DayDetail | null {
  let detail: DayDetail | null = null;
  const off = onStreakDayCompleted((d) => (detail = d));
  for (let i = 0; i < 5; i++) recordStreakActivity(route, { now: il(date), key: keyPrefix ? `${keyPrefix}:${i}` : undefined });
  off();
  return detail;
}

for (const route of ["classic", "daily", "other", "two_players", "multiplayer"] as const) {
  test(`Day 7 in ${route}: milestone, 7-Day Streak achievement and its Mega card are all paid at once, in one event`, () => {
    fresh(0, { lastDay: "2026-10-10", current: 6, best: 6 });
    markAchievementUnlocked("streak-3");
    const coinsBefore = getCoins();
    const d = completeDay(route, "2026-10-11");
    assert.equal(d?.completion.day, 7);
    assert.deepEqual(d?.achievements, [{ id: "streak-7", title: "7-Day Streak", coins: 250 }]);
    assert.deepEqual(d?.megaCards, [{ id: "mega-sword", name: "Legendary Sword" }]);
    assert.equal(getCoins() - coinsBefore, 100 + 250, "milestone + achievement, now - not on a later Classic visit");
    assert.equal(d?.balance, getCoins(), "the card shows the balance after everything");
    assert.ok(getUnlockedAchievementIds().includes("streak-7"));
    assert.ok(getMegaProgress().unlockedCardIds.includes("mega-sword"));
  });
}

test("paid once: a repeated round, a re-completed day, a reload and the album sync never pay or unlock again", () => {
  fresh(0, { lastDay: "2026-10-10", current: 2, best: 2 });
  const d = completeDay("multiplayer", "2026-10-11", "mp:ROOM:1");
  assert.deepEqual(d?.achievements.map((a) => a.id), ["streak-3"]);
  const coins = getCoins();
  assert.equal(completeDay("multiplayer", "2026-10-11", "mp:ROOM:1"), null, "the same rounds again: duplicates");
  assert.equal(completeDay("daily", "2026-10-11"), null, "today already counted");
  replaceSaveData(JSON.parse(JSON.stringify(getSaveData())));
  assert.deepEqual(findNewlyUnlockedAchievements(computeAchievementStats(getProgress()), getUnlockedAchievementIds()).filter((a) => STREAK_IDS.includes(a.id)), []);
  assert.deepEqual(syncAchievementCardUnlocks(), [], "streak-3 has no card; nothing else owed");
  assert.equal(getCoins(), coins);
});

test("several thresholds at once (a long streak from a restored backup): each paid once, cards for each", () => {
  fresh(0, { lastDay: "2026-10-10", current: 29, best: 29 });
  const d = completeDay("daily", "2026-10-11");
  assert.equal(d?.completion.day, 30);
  assert.deepEqual(d?.achievements.map((a) => a.id), ["streak-3", "streak-7", "streak-14", "streak-30"]);
  assert.deepEqual(d?.megaCards.map((m) => m.id).sort(), ["mega-chest", "mega-phoenix", "mega-sword"]);
  assert.equal(d?.completion.emberUnlocked, true);
});

test("a restart never pays: Day 1 after a 12-day streak (achievements already paid) reaches nothing new", () => {
  fresh(0, { lastDay: "2026-10-08", current: 12, best: 12 });
  markAchievementUnlocked("streak-3");
  markAchievementUnlocked("streak-7");
  const d = completeDay("two_players", "2026-10-11");
  assert.equal(d?.completion.day, 1);
  assert.deepEqual([d?.achievements, d?.megaCards], [[], []]);
});

test("legacy floor: the streak path pays only what the Drawing Streak reaches; visit-owed ones stay with Classic", () => {
  fresh(9, { lastDay: "2026-10-10", current: 2, best: 2 });
  const d = completeDay("other", "2026-10-11");
  assert.equal(d?.completion.day, 3);
  assert.deepEqual(d?.achievements.map((a) => a.id), ["streak-3"], "Day 3 of the Drawing Streak");
  assert.ok(!getUnlockedAchievementIds().includes("streak-7"), "owed from visits (9): paid by Classic's launch check, as in 0.58");
  assert.ok(!getMegaProgress().unlockedCardIds.includes("mega-sword"));
});

test("a Rescue that carries a restarted streak past its best pays the achievement it reaches, once", () => {
  fresh(0, { lastDay: "2026-10-08", current: 13, best: 13 });
  for (const id of ["streak-3", "streak-7"]) markAchievementUnlocked(id);
  completeDay("classic", "2026-10-10"); // a missed day, no Save: today restarts at Day 1 (rescue offered)
  const paid = grantStreakRescue("2026-10-10", il("2026-10-10"));
  assert.deepEqual(paid?.achievements.map((a) => a.id), ["streak-14"]);
  assert.deepEqual(paid?.megaCards.map((m) => m.id), ["mega-chest"]);
  assert.equal(grantStreakRescue("2026-10-10", il("2026-10-10")), null, "a repeated grant changes nothing");
});

test("one payer for every achievement: Classic, the Achievements screen and the Drawing Streak all bank through it", () => {
  const classic = src("../screens/ShapeChallengeScreen.tsx");
  const screen = src("../screens/AchievementsScreen.tsx");
  const store = src("../services/drawingStreakStore.ts");
  assert.ok(classic.includes("bankNewAchievements(progress, { pending: true })"));
  assert.ok(screen.includes("bankNewAchievements(getProgress(), { pending: true })"), "reached on the Achievements screen = paid there");
  assert.ok(screen.includes("<AchievementUnlockedBanner"), "with the same tap-to-collect banner");
  assert.ok(store.includes("bankStreakAchievements(c.state.best)") && store.includes("bankStreakAchievements(next.best)"));
  for (const f of ["../screens/ShapeChallengeScreen.tsx", "../screens/AchievementsScreen.tsx", "../services/drawingStreakStore.ts"]) {
    assert.doesNotMatch(src(f), /markAchievementUnlocked\(/, `${f}: never pays an achievement by itself`);
  }
});

test("every streak surface reads the live view (re-read on change, on return to the app and each minute - midnight)", () => {
  for (const f of ["../components/StreakStrip.tsx", "../components/StreakChip.tsx", "../components/StreakSheet.tsx"]) {
    assert.ok(src(f).includes("useStreakView()"), f);
  }
  const hook = src("../hooks/useStreakView.ts");
  for (const needle of ["onStreakChanged(refresh)", '"visibilitychange"', "setInterval(refresh, 60_000)"]) assert.ok(hook.includes(needle), needle);
});
