/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Coin-economy analytics vocabulary: closed buckets and enums, shared by the client
// (which computes them) and the Worker (which validates and stores them). Pure - no
// storage, no side effects - so both sides import the exact same definitions.
//
// Privacy: balances only ever leave the device as a BUCKET. Prices, rewards and earned
// amounts are game-design values (the price of an item, the coins a round paid), not a
// player's balance, so they may be sent as numbers.
//
// The buckets are built around the two economy targets that matter:
//   CATEGORY_UNLOCK_COST = 1,000 (each of 11 paid categories)
//   MEGA_CHALLENGE_UNLOCK_COST = 10,000 (one-time feature unlock)

/**
 * Coin balance buckets. Each edge answers a question:
 *   0_99 / 100_499 ........ coin-poor
 *   500_799 / 800_999 ..... approaching a category unlock (800+ = within 20%)
 *   1k_2.5k ............... can afford a category unlock
 *   2.5k_5k / 5k_8k ....... saving past categories, progressing toward Mega
 *   8k_10k ................ approaching Mega (within 20%)
 *   10k_20k ............... can afford Mega
 *   20k_plus .............. very large balance (nothing left worth buying?)
 */
export const BALANCE_BUCKETS = ["0_99", "100_499", "500_799", "800_999", "1k_2.5k", "2.5k_5k", "5k_8k", "8k_10k", "10k_20k", "20k_plus"] as const;
export type BalanceBucket = (typeof BALANCE_BUCKETS)[number];
const BALANCE_EDGES = [100, 500, 800, 1000, 2500, 5000, 8000, 10000, 20000];

export function balanceBucket(balance: number): BalanceBucket {
  const b = Number.isFinite(balance) ? Math.max(0, balance) : 0;
  let i = 0;
  while (i < BALANCE_EDGES.length && b >= BALANCE_EDGES[i]) i++;
  return BALANCE_BUCKETS[i];
}

/** The next meaningful thing coins can buy: the cheapest still-locked progression unlock. */
export const NEXT_TARGETS = ["category", "mega", "none"] as const;
export type NextTarget = (typeof NEXT_TARGETS)[number];

/**
 * How far the balance is from the next target's price, as a share of that price, so
 * "close" means the same thing for a 1,000 and a 10,000 target. Upper edges inclusive:
 * short_0_10 = missing at most 10% of the price.
 */
export const SHORTFALL_BUCKETS = ["affordable", "short_0_10", "short_10_25", "short_25_50", "short_50_75", "short_75_100", "no_target"] as const;
export type ShortfallBucket = (typeof SHORTFALL_BUCKETS)[number];

export function shortfallBucket(balance: number, targetPrice: number | null): ShortfallBucket {
  if (targetPrice === null || !(targetPrice > 0)) return "no_target";
  const b = Number.isFinite(balance) ? Math.max(0, balance) : 0;
  if (b >= targetPrice) return "affordable";
  const missingShare = (targetPrice - b) / targetPrice;
  if (missingShare <= 0.1) return "short_0_10";
  if (missingShare <= 0.25) return "short_10_25";
  if (missingShare <= 0.5) return "short_25_50";
  if (missingShare <= 0.75) return "short_50_75";
  return "short_75_100";
}

/** Shape Challenge rounds completed (progress.completedRounds) - the main mode's play count. */
export const GAMES_BUCKETS = ["0_9", "10_24", "25_49", "50_99", "100_249", "250_plus"] as const;
export type GamesBucket = (typeof GAMES_BUCKETS)[number];
const GAMES_EDGES = [10, 25, 50, 100, 250];

export function gamesBucket(rounds: number): GamesBucket {
  const n = Number.isFinite(rounds) ? Math.max(0, rounds) : 0;
  let i = 0;
  while (i < GAMES_EDGES.length && n >= GAMES_EDGES[i]) i++;
  return GAMES_BUCKETS[i];
}

/**
 * Whole days since this device first ran an economy-tracking build. `unknown` for a
 * player who already had progress when tracking started - their real start date was
 * never recorded, and guessing would put veterans into d0.
 */
export const PLAYER_AGE_BUCKETS = ["d0", "d1", "d2_3", "d4_7", "d8_14", "d15_30", "d31_plus", "unknown"] as const;
export type PlayerAgeBucket = (typeof PLAYER_AGE_BUCKETS)[number];

export function playerAgeBucket(firstSeenAt: number | null, now: number): PlayerAgeBucket {
  if (firstSeenAt === null || !Number.isFinite(firstSeenAt) || now < firstSeenAt) return "unknown";
  const days = Math.floor((now - firstSeenAt) / 86_400_000);
  if (days <= 0) return "d0";
  if (days === 1) return "d1";
  if (days <= 3) return "d2_3";
  if (days <= 7) return "d4_7";
  if (days <= 14) return "d8_14";
  if (days <= 30) return "d15_30";
  return "d31_plus";
}

/** Whether this is the player's first, second-third or later spend on that sink; `unknown` when it can't be known reliably. */
export const SPEND_ORDINALS = ["first", "2_3", "4_plus", "unknown"] as const;
export type SpendOrdinal = (typeof SPEND_ORDINALS)[number];

export function spendOrdinal(nth: number | null): SpendOrdinal {
  if (nth === null || !Number.isFinite(nth) || nth < 1) return "unknown";
  if (nth === 1) return "first";
  if (nth <= 3) return "2_3";
  return "4_plus";
}

/** Every reason coins can be spent. Required by coinsStore.spendCoins - a spend without a sink does not compile. */
export const COIN_SINKS = ["category_unlock", "mega_unlock", "mega_card_album", "mega_card_shop", "pen_color", "pen_skin", "chest_key", "special_retry"] as const;
export type CoinSink = (typeof COIN_SINKS)[number];

/**
 * Every reason coins can be granted. Required by coinsStore.addCoins/addCoinsPending. The
 * first four are reported on game_completed (coinsEarned), ad_multiplier on the
 * reward_*ad_completed event (baseReward x (multiplier - 1)), and the rest by the
 * low-frequency coin_earned event - see COIN_SOURCE_REPORTING in economyAnalytics.ts.
 */
export const COIN_SOURCES = [
  "shape_stars",
  "artist_stars",
  "special_score",
  "mega_completion",
  "ad_multiplier",
  "achievement",
  "daily_chest",
  "chest_payout",
  "daily_prize",
] as const;
export type CoinSource = (typeof COIN_SOURCES)[number];

/** The subset reported by the coin_earned event (sources no existing event carries). */
export const COIN_EARNED_SOURCES = ["achievement", "daily_chest", "chest_payout", "daily_prize"] as const satisfies readonly CoinSource[];
export type CoinEarnedSource = (typeof COIN_EARNED_SOURCES)[number];

/** Once-per-player economy milestones (category_unlocked: once per paid category, max 11). */
export const ECONOMY_MILESTONES = ["balance_1k_reached", "category_unlocked", "balance_10k_reached", "mega_unlocked"] as const;
export type EconomyMilestone = (typeof ECONOMY_MILESTONES)[number];

/** Analytics Engine stores buckets as 1-based positions in these lists (0 = absent). */
export function bucketPosition<T extends string>(list: readonly T[], value: unknown): number {
  const i = list.indexOf(value as T);
  return i < 0 ? 0 : i + 1;
}

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
