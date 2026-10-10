/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Coin-economy analytics (client). Called by coinsStore on every credit/spend and by the
// reward offer / result screens for context. Never throws into gameplay: every entry
// point swallows its own errors, and a context builder that fails returns null so the
// caller sends the legacy payload instead.
//
// What leaves the device (see economyBuckets.ts): balance BUCKETS only, never a balance;
// prices / rewards / earned amounts (game-design values); games-played and days-playing
// buckets; first-vs-repeat spend. No identifier, no free text. The first-seen date that
// drives the days-playing bucket stays on the device.
//
// Volume: coin_spent and progression_milestone are exact but rare (a purchase, a
// once-per-player milestone). Normal gameplay earnings add NO event - they ride the
// game_completed event the round already sends. coin_earned covers only the sources no
// existing event carries (achievements, chests, daily prizes), summed per source per
// tick, so a burst of achievements is one event.

import { CATEGORY_UNLOCK_COST, MEGA_CHALLENGE_UNLOCK_COST } from "../app/constants";
import { getCategories } from "../content/contentRepository";
import { trackEvent } from "./analytics";
import type { EventParamsMap, GameCompletedCoins, RewardOfferEconomy } from "./analyticsSchema";
import {
  balanceBucket,
  gamesBucket,
  playerAgeBucket,
  shortfallBucket,
  spendOrdinal,
  type CoinEarnedSource,
  type CoinSink,
  type CoinSource,
  type NextTarget,
  type StreakDayBucket,
  type StreakRoute,
} from "./economyBuckets";
import { getPaidCategoryPurchaseCount, nextCategoryUnlockPrice } from "./categoryUnlockStore";
import { isMegaChallengeUnlocked } from "./megaChallengeStore";
import { getSaveData } from "./saveStore";
import { getCategoryCompletedCount, getProgress } from "./shapeChallengeProgress";

/**
 * Where every coin SOURCE is reported. A Record over the full CoinSource union, so adding a
 * source without deciding this is a compile error.
 */
export const COIN_SOURCE_REPORTING: Record<CoinSource, "game_completed" | "reward_ad_completed" | "coin_earned"> = {
  shape_stars: "game_completed",
  artist_stars: "game_completed",
  special_score: "game_completed",
  mega_completion: "game_completed",
  // baseReward x (multiplier - 1) on reward_ad_completed / reward_bonus_ad_completed.
  ad_multiplier: "reward_ad_completed",
  achievement: "coin_earned",
  daily_chest: "coin_earned",
  chest_payout: "coin_earned",
  daily_prize: "coin_earned",
  daily_streak: "coin_earned",
  // Spent on the category unlock in the same tick; the rewarded funnel (placement category_unlock_topup) carries it.
  ad_topup: "reward_ad_completed",
};

/** Every coin SINK is a coin_spent; the two progression unlocks also emit a progression_milestone. */
export const COIN_SINK_REPORTING: Record<CoinSink, "coin_spent" | "coin_spent+progression_milestone"> = {
  category_unlock: "coin_spent+progression_milestone",
  mega_unlock: "coin_spent+progression_milestone",
  mega_card_album: "coin_spent",
  mega_card_shop: "coin_spent",
  pen_color: "coin_spent",
  pen_skin: "coin_spent",
  chest_key: "coin_spent",
  special_retry: "coin_spent",
  streak_save: "coin_spent",
};

// ------------------------------------------------------------------ state ----

const STATE_KEY = "cydi.economyAnalytics.v1";
type EconomyState = {
  v: 1;
  /** When this device first ran an economy-tracking build; null for a player who already had progress then. */
  firstSeenAt: number | null;
  /** Spends per sink since tracking started. */
  spends: Partial<Record<CoinSink, number>>;
  /** True when tracking started before any spend could have happened, so `spends` is the full history. */
  spendHistoryComplete: boolean;
  reached1k: boolean;
  reached10k: boolean;
  /** 0.59.0: Daily-streak milestones (3 / 7 / 30) already reported - once per player each. Absent on older states. */
  streakMilestones?: number[];
};

let memoryState: EconomyState | null = null;

/** Same count the category price reads (categoryUnlockStore), so the purchase ordinal and the price can never disagree. */
const paidCategoryCount = getPaidCategoryPurchaseCount;

function freshState(now: number): EconomyState {
  const progress = getSaveData().progress;
  const coins = progress.coins ?? 0;
  // A save that already shows play or spending predates tracking: its real start date
  // and spend history were never recorded, so they report as unknown, not as new.
  const existingPlayer = (progress.completedRounds ?? 0) > 0 || coins > 0 || paidCategoryCount() > 0 || isMegaChallengeUnlocked();
  return {
    v: 1,
    firstSeenAt: existingPlayer ? null : now,
    spends: {},
    spendHistoryComplete: !existingPlayer,
    // A threshold already crossed before tracking is not a milestone reached now.
    reached1k: coins >= CATEGORY_UNLOCK_COST,
    reached10k: coins >= MEGA_CHALLENGE_UNLOCK_COST,
  };
}

function loadState(now: number = Date.now()): EconomyState {
  if (memoryState) return memoryState;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as EconomyState) : null;
    if (parsed && parsed.v === 1) {
      memoryState = parsed;
      return parsed;
    }
  } catch {
    /* fall through to a fresh state */
  }
  memoryState = freshState(now);
  saveState();
  return memoryState;
}

function saveState(): void {
  try {
    if (memoryState) localStorage.setItem(STATE_KEY, JSON.stringify(memoryState));
  } catch {
    /* in-memory only (private mode / quota) - analytics context, never progress */
  }
}

/**
 * A Backup & Transfer import just replaced the whole save. The tracking state belonged to
 * the save that was on the device, so it is rebuilt from the restored one: a restored save
 * with progress is an existing player of unknown start date and spend history (never a
 * "day 0" player), and a 1,000 / 10,000 threshold it already holds is not a milestone
 * reached now. An empty restored save keeps the current state.
 */
export function onSaveRestored(): void {
  try {
    const restored = freshState(Date.now());
    if (restored.firstSeenAt !== null) return; // restored save shows no progress: nothing to correct
    memoryState = restored;
    saveState();
  } catch {
    /* never break a restore */
  }
}

/** Starts tracking (records first-seen) on app launch, so days-playing counts from the first run, not the first coin. */
export function initEconomyAnalytics(): void {
  try {
    loadState();
  } catch {
    /* never break startup */
  }
}

// --------------------------------------------------------------- context ----

function currentBalance(): number {
  return getSaveData().progress.coins ?? 0;
}

function currentGamesBucket() {
  return gamesBucket(getSaveData().progress.completedRounds ?? 0);
}

/** The cheapest still-locked progression unlock: a paid category first, then Mega. */
export function nextEconomyTarget(): { target: NextTarget; price: number | null } {
  const progress = getProgress();
  const unlocked = getSaveData().progress.unlockedCategories as string[];
  const [first, ...paid] = getCategories();
  const anyLockedCategory = paid.some((c) => c.id !== first?.id && !unlocked.includes(c.id) && getCategoryCompletedCount(progress, c.id) === 0);
  if (anyLockedCategory) return { target: "category", price: nextCategoryUnlockPrice() };
  if (!isMegaChallengeUnlocked()) return { target: "mega", price: MEGA_CHALLENGE_UNLOCK_COST };
  return { target: "none", price: null };
}

/**
 * Economy context for the reward-offer funnel, or null if it cannot be computed (the
 * offer then reports placement only). `balance` is read now - every caller has already
 * credited the base reward by the time it asks.
 *
 * `bonusCoins` overrides what the ad adds when it is not a multiple of the base - the
 * Rewarded experiment's flat "+100" arm, which reports multiplier 1.
 */
export function rewardOfferContext(baseReward: number, multiplier: 1 | 2 | 3, adAvailable: boolean, bonusCoins?: number): RewardOfferEconomy | null {
  try {
    const balance = currentBalance();
    const { target, price } = nextEconomyTarget();
    const extra = bonusCoins ?? Math.max(0, Math.round(baseReward)) * (multiplier - 1);
    return {
      balanceBucket: balanceBucket(balance),
      baseReward: Math.max(1, Math.round(baseReward)),
      multiplier,
      adAvailable,
      nextTarget: target,
      shortfallBucket: shortfallBucket(balance, price),
      adClosesGap: price !== null && balance < price && balance + extra >= price,
      gamesBucket: currentGamesBucket(),
    };
  } catch {
    return null;
  }
}

/** game_completed params, with the coins this game paid and the resulting balance bucket appended when available. */
export function withGameCoins(
  base: { gameType: EventParamsMap["game_started"]["gameType"]; category: EventParamsMap["game_started"]["category"]; contentKey: string },
  coinsEarned: number,
): EventParamsMap["game_completed"] {
  try {
    const coins: GameCompletedCoins = { coinsEarned: Math.max(0, Math.round(coinsEarned)), balanceBucket: balanceBucket(currentBalance()) };
    return { ...base, ...coins };
  } catch {
    return base;
  }
}

// ----------------------------------------------------------------- events ----

/** Bounded extra fields for one coin_earned row - today only the Drawing Streak's day bucket and route. */
export type CoinEarnedDetail = { streakDay: StreakDayBucket; streakRoute: StreakRoute };

const pendingEarned = new Map<CoinEarnedSource, { amount: number; balance: number; detail?: CoinEarnedDetail }>();
let earnFlushScheduled = false;

function flushEarned(): void {
  earnFlushScheduled = false;
  for (const [coinSource, { amount, balance, detail }] of pendingEarned) {
    trackEvent("coin_earned", { coinSource, amount, balanceBucket: balanceBucket(balance), ...(detail ?? {}) });
  }
  pendingEarned.clear();
}

function checkBalanceMilestones(state: EconomyState, balance: number): void {
  if (!state.reached1k && balance >= CATEGORY_UNLOCK_COST) {
    state.reached1k = true;
    emitMilestone("balance_1k_reached", 0, balance, state);
  }
  if (!state.reached10k && balance >= MEGA_CHALLENGE_UNLOCK_COST) {
    state.reached10k = true;
    emitMilestone("balance_10k_reached", 0, balance, state);
  }
}

function emitMilestone(milestone: EventParamsMap["progression_milestone"]["milestone"], categoryOrdinal: number, balance: number, state: EconomyState): void {
  trackEvent("progression_milestone", {
    milestone,
    categoryOrdinal,
    balanceBucket: balanceBucket(balance),
    gamesBucket: currentGamesBucket(),
    playerAgeBucket: playerAgeBucket(state.firstSeenAt, Date.now()),
  });
}

/** coinsStore hook: a credit of `amount` from `source` left the balance at `balanceAfter`. */
export function onCoinsEarned(source: CoinSource, amount: number, balanceAfter: number, detail?: CoinEarnedDetail): void {
  try {
    const state = loadState();
    if (COIN_SOURCE_REPORTING[source] === "coin_earned") {
      const s = source as CoinEarnedSource;
      const prev = pendingEarned.get(s);
      pendingEarned.set(s, { amount: (prev?.amount ?? 0) + Math.round(amount), balance: balanceAfter, detail: detail ?? prev?.detail });
      if (!earnFlushScheduled) {
        earnFlushScheduled = true;
        setTimeout(flushEarned, 0);
      }
    }
    // The Unlock Now top-up is spent on the category in the same tick: it never reaches a balance milestone.
    if (source !== "ad_topup") checkBalanceMilestones(state, balanceAfter);
    saveState();
  } catch {
    /* analytics never breaks a coin credit */
  }
}

/** coinsStore hook: `price` coins spent on `sink`, leaving `balanceAfter`. Called before the purchase is applied. */
export function onCoinsSpent(sink: CoinSink, price: number, balanceAfter: number): void {
  try {
    const state = loadState();
    const count = (state.spends[sink] ?? 0) + 1;
    state.spends[sink] = count;
    // Reliable ordinals: category unlocks are counted from the save itself (the
    // purchase is applied right after this call), Mega is one-time by construction, and
    // any other sink only when tracking has seen this player's whole spend history.
    const categoryOrdinal = sink === "category_unlock" ? paidCategoryCount() + 1 : 0;
    const nth = sink === "category_unlock" ? categoryOrdinal : sink === "mega_unlock" ? 1 : state.spendHistoryComplete ? count : null;
    const ageBucket = playerAgeBucket(state.firstSeenAt, Date.now());
    trackEvent("coin_spent", {
      coinSink: sink,
      price: Math.round(price),
      balanceBucket: balanceBucket(balanceAfter),
      gamesBucket: currentGamesBucket(),
      playerAgeBucket: ageBucket,
      spendOrdinal: spendOrdinal(nth),
    });
    if (sink === "category_unlock") emitMilestone("category_unlocked", categoryOrdinal, balanceAfter, state);
    if (sink === "mega_unlock") emitMilestone("mega_unlocked", 0, balanceAfter, state);
    saveState();
  } catch {
    /* analytics never breaks a purchase */
  }
}

/** The Daily Drawing Streak reached `day`: the first time ever at 3, 7 and 30 days, report it (exact, once each). */
export function onStreakDayReached(day: number): void {
  try {
    const milestone = day === 3 ? "streak_3" : day === 7 ? "streak_7" : day === 30 ? "streak_30" : null;
    if (milestone === null) return;
    const state = loadState();
    const reported = state.streakMilestones ?? [];
    if (reported.includes(day)) return;
    state.streakMilestones = [...reported, day];
    emitMilestone(milestone, 0, currentBalance(), state);
    saveState();
  } catch {
    /* analytics never breaks the streak */
  }
}

/** Tests only. */
export function _resetEconomyAnalyticsForTests(): void {
  memoryState = null;
  pendingEarned.clear();
  earnFlushScheduled = false;
}
