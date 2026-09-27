/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Coin-economy report block (`/report?period=range&...&economy=1`). Opt-in, so a normal
// dashboard load runs no extra Analytics Engine query.
//
// Two sources, by design:
//  - EXACT (AnalyticsDO counters): coin_spent and progression_milestone breakouts -
//    spend by sink, first-vs-repeat, balance after spending, and progression to the
//    1,000 / 10,000 targets with games-played / days-playing buckets.
//  - TELEMETRY (Analytics Engine, schema 2 rows only): the rewarded-offer funnel by the
//    player's economy state, the balance distribution at game completion, and the coin
//    source mix. EVERY funnel stage is read from AE - including the stages that are also
//    exact - so each conversion rate has one source for numerator and denominator.
//
// Everything here is read-only and aggregates; no row carries an identifier.

import {
  BALANCE_BUCKETS,
  COIN_SINKS,
  ECONOMY_MILESTONES,
  GAMES_BUCKETS,
  NEXT_TARGETS,
  PLAYER_AGE_BUCKETS,
  SHORTFALL_BUCKETS,
  SPEND_ORDINALS,
} from "../src/services/economyBuckets";
import type { AeFetch, AeRow } from "./analyticsAeReport";

export const ECONOMY_AE_DATASET = "cydi_analytics_shadow_v1";

/** Offer-funnel stages; each maps its ×2 and ×3 (bonus) event names to one stage. */
const STAGE_OF: Record<string, "offers" | "starts" | "completions" | "fails" | "skips"> = {
  reward_offer_shown: "offers",
  reward_bonus_offer_shown: "offers",
  reward_ad_started: "starts",
  reward_bonus_ad_started: "starts",
  reward_ad_completed: "completions",
  reward_bonus_ad_completed: "completions",
  reward_ad_failed: "fails",
  reward_bonus_ad_failed: "fails",
  reward_skipped: "skips",
  reward_bonus_skipped: "skips",
};
export const OFFER_FUNNEL_EVENTS = Object.keys(STAGE_OF);

/** Base-reward size buckets (coins before the multiplier). */
export const REWARD_SIZE_BUCKETS = ["1_49", "50_99", "100_249", "250_499", "500_999", "1000_plus"] as const;

/** game_completed gameType -> the coin source it reports. */
const SOURCE_OF_GAME_TYPE: Record<string, string> = {
  shapeChallenge: "shape_stars",
  artistPack: "artist_stars",
  specialChallenge: "special_score",
  megaChallenge: "mega_completion",
  dailyChallenge: "daily_challenge_game",
};

const sqlTime = (ms: number) => `toDateTime('${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}')`;
const sqlList = (items: Iterable<string>) => [...items].map((s) => `'${s.replace(/'/g, "")}'`).join(",");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;
const label = (list: readonly string[], position: unknown) => list[num(position) - 1] ?? "unknown";

/** The AE queries for one window. Only schema-2 rows (double1 >= 2) carry economy context. */
export function buildEconomyAeQueries(startMs: number, endMs: number): Record<string, string> {
  const T = `timestamp >= ${sqlTime(startMs)} AND timestamp < ${sqlTime(endMs)} AND double1 >= 2`;
  // Schema-2 columns (analyticsShadow.ts): 14 balance, 15 target*10+shortfall, 16 multiplier,
  // 17 offer flags, 18 coins, 19 games, 20 reserved sampleWeight (1).
  const F = `${T} AND blob1 IN (${sqlList(OFFER_FUNNEL_EVENTS)}) AND double17 > 0`;
  const avail = `if(double17 = 2 OR double17 = 4, 1, 0)`;
  const size = `multiIf(double18 < 50, 1, double18 < 100, 2, double18 < 250, 3, double18 < 500, 4, double18 < 1000, 5, 6)`;
  const funnel = (key: string) =>
    `SELECT blob1 AS ev, blob7 AS aud, ${key} AS k, ${avail} AS avail, sum(_sample_interval) AS n FROM ${ECONOMY_AE_DATASET} WHERE ${F} GROUP BY ev, aud, k, avail`;
  return {
    funnelBalance: funnel("double14"),
    funnelShortfall: funnel("double15"),
    funnelReward: funnel(`double16 * 10 + ${size}`),
    funnelGap: funnel("if(double17 >= 3, 1, 0)"),
    funnelGames: funnel("double19"),
    earnGames: `SELECT blob7 AS aud, blob9 AS gameType, double14 AS k, sum(_sample_interval) AS n, sum(double18 * _sample_interval) AS coins FROM ${ECONOMY_AE_DATASET} WHERE ${T} AND blob1 = 'game_completed' AND double14 > 0 GROUP BY aud, gameType, k`,
    earnRare: `SELECT blob7 AS aud, blob20 AS detail, sum(_sample_interval) AS n, sum(double10 * _sample_interval) AS coins FROM ${ECONOMY_AE_DATASET} WHERE ${T} AND blob1 = 'coin_earned' GROUP BY aud, detail`,
    earnAd: `SELECT blob7 AS aud, double16 AS m, sum(_sample_interval) AS n, sum(double18 * (double16 - 1) * _sample_interval) AS coins FROM ${ECONOMY_AE_DATASET} WHERE ${T} AND blob1 IN ('reward_ad_completed', 'reward_bonus_ad_completed') AND double16 > 0 GROUP BY aud, m`,
  };
}

/**
 * `*WithAd` counts only stages of offers that had a servable rewarded ad when they rendered
 * (the flag is frozen per offer, so every stage of one offer shares it). Rates use those,
 * so an offer with no ad behind it can neither dilute nor inflate a conversion rate.
 */
type FunnelCell = { offers: number; offersWithAd: number; starts: number; startsWithAd: number; completions: number; completionsWithAd: number; fails: number; skips: number };
export type FunnelRow = FunnelCell & { startRate: number | null; completionRate: number | null; skipRate: number | null };
const emptyCell = (): FunnelCell => ({ offers: 0, offersWithAd: 0, starts: 0, startsWithAd: 0, completions: 0, completionsWithAd: 0, fails: 0, skips: 0 });

/** Rates are over offers where a rewarded ad could actually be served - an offer with no ad behind it cannot convert. */
function finish(cell: FunnelCell): FunnelRow {
  const d = cell.offersWithAd;
  return { ...cell, startRate: d > 0 ? cell.startsWithAd / d : null, completionRate: d > 0 ? cell.completionsWithAd / d : null, skipRate: cell.offers > 0 ? cell.skips / cell.offers : null };
}

function inAudience(row: AeRow, audience: string): boolean {
  return audience === "all" || String(row.aud) === audience;
}

function funnelBy(rows: AeRow[], audience: string, keyOf: (k: number) => string): Record<string, FunnelRow> {
  const cells: Record<string, FunnelCell> = {};
  for (const row of rows) {
    if (!inAudience(row, audience)) continue;
    const stage = STAGE_OF[String(row.ev)];
    if (!stage) continue;
    const key = keyOf(num(row.k));
    const cell = (cells[key] ??= emptyCell());
    const n = num(row.n);
    cell[stage] += n;
    if (num(row.avail) === 1) {
      if (stage === "offers") cell.offersWithAd += n;
      if (stage === "starts") cell.startsWithAd += n;
      if (stage === "completions") cell.completionsWithAd += n;
    }
  }
  return Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, finish(c)]));
}

export type EconomyTelemetry = {
  rewardFunnel: {
    total: FunnelRow;
    byBalance: Record<string, FunnelRow>;
    byTargetShortfall: Record<string, FunnelRow>;
    byMultiplierRewardSize: Record<string, FunnelRow>;
    byAdClosesGap: Record<string, FunnelRow>;
    byGames: Record<string, FunnelRow>;
  };
  balanceAtGameCompleted: Record<string, number>;
  balanceAtGameCompletedByGameType: Record<string, Record<string, number>>;
  sourceMix: Record<string, { events: number; coins: number }>;
};

/** Rows of every economy query -> the telemetry half of the economy block for one audience. */
export function economyTelemetryFromRows(results: Record<string, AeRow[]>, audience: string): EconomyTelemetry {
  const byBalance = funnelBy(results.funnelBalance ?? [], audience, (k) => label(BALANCE_BUCKETS, k));
  const total = finish(
    Object.values(byBalance).reduce((acc, r) => {
      for (const f of ["offers", "offersWithAd", "starts", "startsWithAd", "completions", "completionsWithAd", "fails", "skips"] as const) acc[f] += r[f];
      return acc;
    }, emptyCell()),
  );
  const balanceAtGameCompleted: Record<string, number> = {};
  const balanceAtGameCompletedByGameType: Record<string, Record<string, number>> = {};
  const sourceMix: Record<string, { events: number; coins: number }> = {};
  const addSource = (source: string, events: number, coins: number) => {
    const s = (sourceMix[source] ??= { events: 0, coins: 0 });
    s.events += events;
    s.coins += coins;
  };
  for (const row of results.earnGames ?? []) {
    if (!inAudience(row, audience)) continue;
    const bucket = label(BALANCE_BUCKETS, row.k);
    const n = num(row.n);
    balanceAtGameCompleted[bucket] = (balanceAtGameCompleted[bucket] ?? 0) + n;
    const gt = String(row.gameType);
    (balanceAtGameCompletedByGameType[gt] ??= {})[bucket] = (balanceAtGameCompletedByGameType[gt]?.[bucket] ?? 0) + n;
    addSource(SOURCE_OF_GAME_TYPE[gt] ?? `game:${gt}`, n, num(row.coins));
  }
  for (const row of results.earnRare ?? []) {
    if (!inAudience(row, audience)) continue;
    const source = String(row.detail).replace(/^coinSource:/, "") || "unknown";
    addSource(source, num(row.n), num(row.coins));
  }
  for (const row of results.earnAd ?? []) {
    if (!inAudience(row, audience)) continue;
    addSource(num(row.m) === 3 ? "ad_multiplier_x3" : "ad_multiplier_x2", num(row.n), num(row.coins));
  }
  return {
    rewardFunnel: {
      total,
      byBalance,
      byTargetShortfall: funnelBy(results.funnelShortfall ?? [], audience, (k) => `${label(NEXT_TARGETS, Math.floor(k / 10))}|${label(SHORTFALL_BUCKETS, k % 10)}`),
      byMultiplierRewardSize: funnelBy(results.funnelReward ?? [], audience, (k) => `x${Math.floor(k / 10)}|${label(REWARD_SIZE_BUCKETS, k % 10)}`),
      byAdClosesGap: funnelBy(results.funnelGap ?? [], audience, (k) => (k === 1 ? "ad_closes_gap" : "ad_does_not_close_gap")),
      byGames: funnelBy(results.funnelGames ?? [], audience, (k) => label(GAMES_BUCKETS, k)),
    },
    balanceAtGameCompleted,
    balanceAtGameCompletedByGameType,
    sourceMix,
  };
}

export async function fetchEconomyTelemetry(query: AeFetch, startMs: number, endMs: number, audience: string): Promise<EconomyTelemetry> {
  const queries = buildEconomyAeQueries(startMs, endMs);
  const entries = await Promise.all(Object.entries(queries).map(async ([name, sql]) => [name, await query(sql)] as const));
  return economyTelemetryFromRows(Object.fromEntries(entries), audience);
}

type EconomyCounters = { total: number; byEconomy?: Record<string, number>; economySum?: Record<string, number> } | undefined;

/** Splits "<dimension>:<a>|<b>" byEconomy keys into nested tables. */
function table(map: Record<string, number> | undefined, dimension: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(map ?? {})) if (key.startsWith(`${dimension}:`)) out[key.slice(dimension.length + 1)] = n;
  return out;
}
function nested(map: Record<string, number> | undefined, dimension: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [pair, n] of Object.entries(table(map, dimension))) {
    const [a, b] = pair.split("|");
    (out[a] ??= {})[b] = n;
  }
  return out;
}

/** The exact half of the economy block, from the selected audience's merged DO counters. */
export function economyExactFromCounters(coinSpent: EconomyCounters, milestone: EconomyCounters) {
  const bySink: Record<string, { count: number; coins: number }> = {};
  for (const sink of COIN_SINKS) {
    const count = coinSpent?.byEconomy?.[`sink:${sink}`] ?? 0;
    if (count > 0) bySink[sink] = { count, coins: coinSpent?.economySum?.[`price:${sink}`] ?? 0 };
  }
  return {
    spend: {
      total: coinSpent?.total ?? 0,
      bySink,
      ordinalBySink: nested(coinSpent?.byEconomy, "sinkOrdinal"),
      balanceAfter: table(coinSpent?.byEconomy, "balanceAfter"),
      balanceAfterBySink: nested(coinSpent?.byEconomy, "sinkBalanceAfter"),
      games: table(coinSpent?.byEconomy, "games"),
      age: table(coinSpent?.byEconomy, "age"),
    },
    milestones: {
      counts: Object.fromEntries(ECONOMY_MILESTONES.map((m) => [m, milestone?.byEconomy?.[`milestone:${m}`] ?? 0])),
      byGames: nested(milestone?.byEconomy, "milestoneGames"),
      byAge: nested(milestone?.byEconomy, "milestoneAge"),
      byBalance: nested(milestone?.byEconomy, "milestoneBalance"),
      categoryOrdinal: table(milestone?.byEconomy, "categoryOrdinal"),
      categoryOrdinalByGames: nested(milestone?.byEconomy, "categoryOrdinalGames"),
      categoryOrdinalByAge: nested(milestone?.byEconomy, "categoryOrdinalAge"),
    },
    buckets: { balance: BALANCE_BUCKETS, games: GAMES_BUCKETS, playerAge: PLAYER_AGE_BUCKETS, spendOrdinal: SPEND_ORDINALS, shortfall: SHORTFALL_BUCKETS, rewardSize: REWARD_SIZE_BUCKETS },
  };
}
