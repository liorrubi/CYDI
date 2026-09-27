// Coin-economy analytics, client side. Runs the REAL coin, save, category and Mega stores
// against an in-memory localStorage and captures what trackEvent would send.
//
// What must hold:
//  - every coin grant/spend path names its source/sink, and every source/sink has an
//    analytics classification (a new call site cannot slip through unclassified);
//  - category / Mega unlocks emit coin_spent + progression_milestone (exact events);
//  - normal gameplay earnings add NO event (they ride game_completed); rare sources are
//    one coin_earned per source per tick;
//  - rewarded offers carry correct economy context; no payload ever carries a balance.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, setTimeout, clearTimeout };
store.set("cydi.analyticsDebug.v1", "1"); // analytics is dev-gated; the flag turns it on under node

const { registerAnalyticsProvider } = await import("./analytics.ts");
const { validateEventParams } = await import("./analyticsSchema.ts");
const { addCoins, addCoinsPending, spendCoins, getCoins } = await import("./coinsStore.ts");
const { updateSaveData, replaceSaveData } = await import("./saveStore.ts");
const { createDefaultSaveData } = await import("./saveData.ts");
const { unlockCategory } = await import("./categoryUnlockStore.ts");
const { unlockMegaChallenge } = await import("./megaChallengeStore.ts");
const { COIN_SOURCES, COIN_SINKS, COIN_EARNED_SOURCES, BALANCE_BUCKETS } = await import("./economyBuckets.ts");
const E = await import("./economyAnalytics.ts");

type Sent = { name: string; params: Record<string, unknown> };
const sent: Sent[] = [];
registerAnalyticsProvider({ name: "test-capture", trackEvent: (name: string, params: unknown) => void sent.push({ name, params: params as Record<string, unknown> }) } as never);
const tick = () => new Promise((r) => setTimeout(r, 5));
const named = (name: string) => sent.filter((s) => s.name === name && !s.params.__noise);

/**
 * A player who installs a tracking build and then plays up to `coins` / `completedRounds`
 * (tracking starts on the empty save), or - with `existing` - one who already had that
 * progress when the tracking build arrived.
 */
function freshPlayer(coins = 0, completedRounds = 0, existing = false) {
  for (const k of [...store.keys()]) if (k !== "cydi.analyticsDebug.v1") store.delete(k);
  replaceSaveData(createDefaultSaveData()); // saveStore caches the save in memory
  const setProgress = () =>
    updateSaveData((d) => {
      d.progress.coins = coins;
      d.progress.completedRounds = completedRounds;
    });
  E._resetEconomyAnalyticsForTests();
  if (existing) setProgress();
  E.initEconomyAnalytics();
  if (!existing) setProgress();
  sent.length = 0;
}

// ------------------------------------------------------------ coverage ----

test("every coin source and sink has exactly one analytics classification", () => {
  assert.deepEqual(Object.keys(E.COIN_SOURCE_REPORTING).sort(), [...COIN_SOURCES].sort());
  assert.deepEqual(Object.keys(E.COIN_SINK_REPORTING).sort(), [...COIN_SINKS].sort());
  const viaCoinEarned = COIN_SOURCES.filter((s) => E.COIN_SOURCE_REPORTING[s] === "coin_earned");
  assert.deepEqual(viaCoinEarned.sort(), [...COIN_EARNED_SOURCES].sort(), "coin_earned carries exactly the sources no other event does");
});

/** Every non-test source file under src/. */
function sources(dir = join(import.meta.dirname, "..")): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ path: p.replace(/\\/g, "/").split("/src/")[1], text: readFileSync(p, "utf8") });
  }
  return out;
}

test("every current coin grant/spend call site names its source/sink - the audited map, nothing missing", () => {
  const found: string[] = [];
  for (const { path, text: raw } of sources()) {
    if (path === "services/coinsStore.ts") continue;
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const m of text.matchAll(/\b(addCoins|addCoinsPending|spendCoins)\(([^;]*?),\s*(isPaidChest \? "chest_payout" : "daily_chest"|"[a-z_]+")\)/g)) {
      found.push(`${path}:${m[1]}:${m[3].replace(/"/g, "")}`);
    }
    // A call with no second argument would not compile; this catches anything the regex misses.
    const calls = [...text.matchAll(/\b(addCoins|addCoinsPending|spendCoins)\(/g)].length;
    const classified = [...text.matchAll(/\b(addCoins|addCoinsPending|spendCoins)\(([^;]*?),\s*(isPaidChest \? "chest_payout" : "daily_chest"|"[a-z_]+")\)/g)].length;
    if (calls > 0) assert.equal(classified, calls, `${path}: every coin call is classified`);
  }
  assert.deepEqual(found.sort(), [
    "app/shapeRoundOutcome.ts:addCoins:shape_stars",
    "components/ChestRewardOverlay.tsx:addCoins:ad_multiplier",
    "components/ChestRewardOverlay.tsx:addCoins:isPaidChest ? chest_payout : daily_chest",
    "screens/ArtistPackScreen.tsx:addCoins:ad_multiplier",
    "screens/ArtistPackScreen.tsx:addCoins:artist_stars",
    "screens/DailyChallengeScreen.tsx:addCoins:daily_prize",
    "screens/MegaChallengeScreen.tsx:addCoins:ad_multiplier",
    "screens/MegaChallengeScreen.tsx:addCoins:mega_completion",
    "screens/MegaChallengeScreen.tsx:spendCoins:mega_card_album",
    "screens/ShapeChallengeScreen.tsx:addCoins:ad_multiplier",
    "screens/ShapeChallengeScreen.tsx:addCoinsPending:achievement",
    "screens/ShapeChallengeScreen.tsx:spendCoins:category_unlock",
    "screens/ShapeChallengeScreen.tsx:spendCoins:mega_unlock",
    "screens/ShopScreen.tsx:spendCoins:chest_key",
    "screens/ShopScreen.tsx:spendCoins:mega_card_shop",
    "screens/ShopScreen.tsx:spendCoins:pen_color",
    "screens/ShopScreen.tsx:spendCoins:pen_skin",
    "screens/SpecialChallengeScreen.tsx:addCoins:ad_multiplier",
    "screens/SpecialChallengeScreen.tsx:addCoins:special_score",
    "screens/SpecialChallengeScreen.tsx:spendCoins:special_retry",
  ].sort(), "13 grants + 8 spends (the chest's daily/paid pair is one call) - a new call site must be added here deliberately");
});

test("nothing writes the coin balance directly except coinsStore and the one-time legacy import", () => {
  const writers = sources().filter(({ text }) => /progress\.coins\s*=[^=]/.test(text)).map(({ path }) => path).sort();
  assert.deepEqual(writers, ["services/coinsStore.ts", "services/legacyImport.ts"]);
});

// -------------------------------------------------------------- unlocks ----

test("category unlock: exact coin_spent + category_unlocked milestone, ordinal counted from the save", async () => {
  freshPlayer(2600);
  spendCoins(1000, "category_unlock");
  unlockCategory("symbols" as never);
  const [spend] = named("coin_spent");
  assert.deepEqual(spend.params, { coinSink: "category_unlock", price: 1000, balanceBucket: "1k_2.5k", gamesBucket: "0_9", playerAgeBucket: "d0", spendOrdinal: "first" });
  const [m] = named("progression_milestone");
  assert.deepEqual(m.params, { milestone: "category_unlocked", categoryOrdinal: 1, balanceBucket: "1k_2.5k", gamesBucket: "0_9", playerAgeBucket: "d0" });
  spendCoins(1000, "category_unlock");
  assert.equal(named("coin_spent")[1].params.spendOrdinal, "2_3");
  assert.equal(named("progression_milestone")[1].params.categoryOrdinal, 2);
  for (const s of sent) assert.equal(validateEventParams(s.name as never, s.params).valid, true, `${s.name} passes the server's validator`);
});

test("Mega unlock: exact coin_spent (first) + mega_unlocked milestone", () => {
  freshPlayer(12_000);
  assert.equal(unlockMegaChallenge(), true);
  spendCoins(10_000, "mega_unlock");
  assert.deepEqual(named("coin_spent")[0].params, { coinSink: "mega_unlock", price: 10_000, balanceBucket: "1k_2.5k", gamesBucket: "0_9", playerAgeBucket: "d0", spendOrdinal: "first" });
  assert.equal(named("progression_milestone").find((m) => m.params.milestone === "mega_unlocked")?.params.categoryOrdinal, 0);
});

test("an existing player's history is honest: days-playing and non-derivable ordinals are 'unknown'", () => {
  freshPlayer(3000, 40, true); // already had progress when tracking started
  spendCoins(500, "chest_key");
  const [spend] = named("coin_spent");
  assert.equal(spend.params.playerAgeBucket, "unknown");
  assert.equal(spend.params.spendOrdinal, "unknown", "earlier chest keys were never recorded");
  assert.equal(spend.params.gamesBucket, "25_49");
});

// -------------------------------------------------------------- earning ----

test("normal gameplay earnings add no event; rare sources are one coin_earned per source per tick", async () => {
  freshPlayer(0);
  addCoins(80, "shape_stars");
  addCoins(80, "ad_multiplier");
  await tick();
  assert.equal(named("coin_earned").length, 0, "rounds report on game_completed, doubles on reward_ad_completed");
  addCoinsPending(250, "achievement");
  addCoinsPending(250, "achievement"); // two achievements in one tick
  addCoins(90, "daily_chest");
  await tick();
  const earned = named("coin_earned").map((s) => s.params);
  assert.deepEqual(earned, [
    { coinSource: "achievement", amount: 500, balanceBucket: "500_799" },
    { coinSource: "daily_chest", amount: 90, balanceBucket: "500_799" },
  ]);
});

test("balance milestones fire once, at the crossing - and never for a threshold crossed before tracking", async () => {
  freshPlayer(950);
  addCoins(80, "shape_stars");
  addCoins(80, "shape_stars");
  assert.deepEqual(named("progression_milestone").map((m) => m.params.milestone), ["balance_1k_reached"]);
  freshPlayer(15_000, 5, true);
  addCoins(80, "shape_stars");
  assert.equal(named("progression_milestone").length, 0);
});

test("game_completed carries the coins that game paid and the resulting balance bucket - never the balance", () => {
  freshPlayer(937);
  const p = E.withGameCoins({ gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, 55);
  assert.deepEqual(p, { gameType: "shapeChallenge", category: "geometric", contentKey: "circle", coinsEarned: 55, balanceBucket: "800_999" });
  assert.equal(validateEventParams("game_completed", p).valid, true);
  assert.equal(JSON.stringify(p).includes("937"), false);
});

// ------------------------------------------------------------- rewarded ----

test("rewarded offer context: balance bucket, target, shortfall and whether the ad would close the gap", () => {
  freshPlayer(937); // a paid category is still locked -> target 1,000
  const ctx = E.rewardOfferContext(80, 2, true)!;
  assert.deepEqual(ctx, { balanceBucket: "800_999", baseReward: 80, multiplier: 2, adAvailable: true, nextTarget: "category", shortfallBucket: "short_0_10", adClosesGap: true, gamesBucket: "0_9" });
  assert.equal(E.rewardOfferContext(20, 2, false)!.adClosesGap, false, "937 + 20 < 1,000");
  assert.equal(E.rewardOfferContext(20, 3, false)!.adClosesGap, false, "937 + 40 < 1,000");
  assert.equal(E.rewardOfferContext(40, 3, false)!.adClosesGap, true, "937 + 80 >= 1,000");
  assert.equal(validateEventParams("reward_offer_shown", { placement: "shape_challenge_double_reward", ...ctx }).valid, true);
  assert.equal(JSON.stringify(ctx).includes("937"), false, "no exact balance in the payload");
  for (const v of Object.values(ctx)) if (typeof v === "string" && /^\d/.test(v)) assert.ok((BALANCE_BUCKETS as readonly string[]).includes(v) || /_/.test(v));
});

test("no emitted economy payload contains the exact balance", async () => {
  freshPlayer(4321);
  spendCoins(1000, "pen_color");
  addCoinsPending(50, "achievement");
  await tick();
  assert.ok(sent.length >= 2);
  for (const s of sent) {
    const json = JSON.stringify(s.params);
    for (const balance of [4321, 3321, 3371]) assert.equal(json.includes(String(balance)), false, `${s.name} leaks ${balance}`);
  }
  assert.equal(getCoins(), 3371);
});

test("every rewarded-offer funnel event carries the offer's economy context; the exit forfeit uses the offer's own skip name", () => {
  const offer = readFileSync(join(import.meta.dirname, "..", "components", "DoubleCoinsOffer.tsx"), "utf8");
  for (const [bonus, plain] of [["reward_bonus_offer_shown", "reward_offer_shown"], ["reward_bonus_ad_started", "reward_ad_started"], ["reward_bonus_ad_completed", "reward_ad_completed"], ["reward_bonus_ad_failed", "reward_ad_failed"], ["reward_bonus_skipped", "reward_skipped"]]) {
    const emits = offer.split(`trackEvent(isBonusRound ? "${bonus}" : "${plain}", `).length - 1;
    const withContext = offer.split(`trackEvent(isBonusRound ? "${bonus}" : "${plain}", funnelParams())`).length - 1;
    assert.ok(emits > 0, `${plain} is emitted`);
    assert.equal(withContext, emits, `every ${plain} emit carries economy context`);
  }
  const screen = readFileSync(join(import.meta.dirname, "..", "screens", "ShapeChallengeScreen.tsx"), "utf8");
  assert.match(screen, /if \(offerSkipReporterRef\.current\) offerSkipReporterRef\.current\(\);/, "leaving a ×3 offer records reward_bonus_skipped, not reward_skipped");
  assert.equal((screen.match(/onSkipReporter=/g) ?? []).length, 2, "both result layouts wire the reporter");
});

test("Backup & Transfer restore of a veteran save onto a fresh install: unknown history, no false 'first' milestones", () => {
  freshPlayer(0); // brand-new install, tracking started (d0)
  updateSaveData((d) => {
    d.progress.coins = 6500;
    d.progress.completedRounds = 120;
  }); // what replaceSaveData(parsed) leaves behind
  E.onSaveRestored();
  addCoins(80, "shape_stars");
  spendCoins(500, "chest_key");
  assert.equal(named("progression_milestone").length, 0, "the restored 6,500 had already crossed 1,000 - not a milestone now");
  const [spend] = named("coin_spent");
  assert.equal(spend.params.playerAgeBucket, "unknown");
  assert.equal(spend.params.spendOrdinal, "unknown");
  const transfer = readFileSync(join(import.meta.dirname, "saveTransfer.ts"), "utf8");
  assert.match(transfer, /replaceSaveData\(parsed\);\s*\/\/[^\n]*\n\s*onSaveRestored\(\);/, "the import path rebuilds the economy state");
});
