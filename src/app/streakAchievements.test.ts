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
(globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, setTimeout, clearTimeout };

const { getSaveData, updateSaveData, replaceSaveData } = await import("../services/saveStore.ts");
const { createDefaultSaveData } = await import("../services/saveData.ts");
const { getCoins } = await import("../services/coinsStore.ts");
const { getStreakView, recordStreakActivity } = await import("../services/drawingStreakStore.ts");
const { getLegacyVisitStreakBest } = await import("../services/dailyStreakStore.ts");
const { ACHIEVEMENTS, computeAchievementStats, findNewlyUnlockedAchievements } = await import("./achievements.ts");
const { getProgress } = await import("../services/shapeChallengeProgress.ts");
const { getUnlockedAchievementIds, markAchievementUnlocked } = await import("../services/achievementsStore.ts");
const { syncAchievementCardUnlocks, getMegaProgress } = await import("../services/megaChallengeStore.ts");
const { closeStreakCard, isStreakCardOpen, openStreakCard, whenStreakCardClosed } = await import("./streakCardGate.ts");
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
