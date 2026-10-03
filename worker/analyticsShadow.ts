/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Phase 1 Analytics Engine SHADOW WRITE.
//
// A second, independent copy of accepted analytics events, written to Workers
// Analytics Engine (AE) so the unsampled telemetry stream can be evaluated against
// AnalyticsDO. It is NOT a migration and nothing reads it yet: no report, no
// dashboard, no guard. AnalyticsDO stays the system of record, including every exact
// / preserved event.
//
// WHERE IT RUNS. In the Worker, on the ingest request, BEFORE the shed decision - so
// AE sees what the client actually sent while the DO keeps receiving exactly the
// sample it receives today. The production path does not wait on, branch on, or even
// learn the outcome of this write.
//
// WHY IT IS FREE ON THE SCARCE COUNTERS. writeDataPoint() is not a subrequest and not
// a DO request - measured on this account on 25 Sep 2026 with an isolated probe (200
// writes -> +0 subrequests; 10 fetches -> +10). It adds no inbound request either: it
// rides on the analytics request that already arrived.
//
// ACCEPTANCE MIRRORS THE DO EXACTLY. An envelope is written only if AnalyticsDO would
// count it: same body-size caps, same batch bounds, same isAnalyticsEventName +
// validateEventParams check, per-entry skipping inside a batch. Anything the DO would
// 400 never reaches AE. The normalizers are the DO's own, so a dimension here means
// the same thing as the matching counter breakout there.
//
// FAIL-OPEN, ALWAYS. writeAnalyticsShadow() never throws and never returns anything
// the caller acts on. A missing binding, a throwing binding or an unparseable body all
// mean "write nothing", and ingest carries on untouched.
//
// PRIVACY. No installationId, sessionId, IP, city/region, user agent, nickname, room
// code or free-form string is ever written. Country is the same coarse two-letter code
// the DO already stores. customChallenge content keys are dropped for the reason the DO
// drops them from byContentKey (near-unique per creator). The index is a RANDOM bucket,
// not an installation-derived value - see AE_INDEX_BUCKETS.
//
// SCHEMA (positional - AE columns are blob1..blob20 / double1..double20, so the order
// below IS the schema; append, never reorder, and bump AE_SCHEMA_VERSION on change):
//   blob1  event            canonical stored name (canonicalEventName)
//   blob2  route            "event" (legacy single) | "events" (batch)
//   blob3  country          normalizeCountry, ZZ = unknown
//   blob4  platform         android | ios | web | unknown
//   blob5  appVersion       normalizeAppVersion
//   blob6  appVersionCode   Android native versionCode, normalized
//   blob7  audience         external | internal
//   blob8  mode             classic | multiplayer | twoPlayers | "" (derived, see modeFor)
//   blob9  gameType         funnel events only
//   blob10 category         funnel + scored events
//   blob11 contentKey       funnel events only, never for customChallenge
//   blob12 source           attribution (web only today), "" when the build sends none
//   blob13 medium
//   blob14 campaign
//   blob15 content          utm_content (Short video id)
//   blob16 placement        rewarded placement
//   blob17 reason           ad / interstitial failure reason
//   blob18 arm              interstitial arm
//   blob19 outcome          interstitial outcome
//   blob20 detail           one bounded enum param as "key:value" (see DETAIL_PARAMS)
//   double1  schemaVersion  double2 starRating  double3 passed  double4 isNewBest
//   double5  roundCount     double6 roundIndex  double7 playerCount  double8 price
//   double9  gamesBetweenAds  double10 amount   double11 submitted  double12 hadCache
//   double13 batchSize (envelopes in the request, valid or not)
//   --- schema 2 (coin economy; 0 = the event carries no economy context) ---
//   double14 balanceBucket     1-based position in BALANCE_BUCKETS
//   double15 targetShortfall   nextTarget position x 10 + shortfallBucket position (NEXT_TARGETS / SHORTFALL_BUCKETS)
//   double16 multiplier        2 | 3 (reward offer funnel)
//   double17 offerFlags        1 + (adAvailable ? 1 : 0) + (adClosesGap ? 2 : 0), i.e. 1..4
//   double18 coins             game_completed coinsEarned | reward offer baseReward
//   double19 gamesBucket       1-based position in GAMES_BUCKETS
//   double20 sampleWeight      RESERVED for a possible write-time sampling guard; always 1
//                              (unsampled) today, on every row. Counts stay sum(_sample_interval).
//   --- schema 3 (Rewarded Ads Experiment v1; no new columns - reward-offer rows never
//   carry the params these slots were named for, so they are reused on those rows only) ---
//   blob18 arm                 also the rewarded arm: "x3" | "plus100" (reward_* funnel + reward_continuation)
//   blob19 outcome             also reward_continuation's outcome: completed | skipped | failed;
//                              on reward_* funnel rows: the installation's interstitialArm
//                              (treatment | control | none), to stratify Rewarded by interstitial arm
//   double5  sessionGames      reward_* funnel rows: completed Classic games in the session at the offer
//   double6  offerNumber       reward_* funnel + reward_continuation rows: the offer's number in the session
//   double10 bonusCoins        reward_* funnel rows: coins the ad adds (x3: base x 2; plus100: 100)
//   double16 multiplier        1 = flat bonus (the "plus100" arm; see double10)
//   --- 0.56 ad-readiness diagnostics (no new columns, schema stays 3: these slots are never
//   used by an ad row for their original meaning, so they carry the diagnostics on rewarded_ad_*
//   and interstitial_* rows only; always filter on blob1 first) ---
//   double2  code + 2     numeric GMA error code of the failed load (so -1 -> 1, 0 -> 2; 0 = no code)
//   double3  attempt      interstitial attempt number for this opportunity, 1 | 2 (0 = none)
//   double4  latency      1-based position in AD_LATENCY_BUCKETS (lt5s .. gt45s; 0 = none)
//   double7  source       1 preload | 2 click (rewarded_ad_loaded / rewarded_ad_unavailable)
//   double8  stateAtTap   1-based position in REWARDED_TAP_STATES (rewarded_ad_requested / _unavailable)
//   blob20   detail       cause:<failed|loading|not_attempted|blocked|expired> (rewarded `cause`,
//                         interstitial `notReadyCause`)
//   --- 0.57 (no new columns, schema stays 3) ---
//   double9  mpDailyOrdinal   mp_game_started rows only: this device's Nth multiplayer game of the local
//                             day, 1..7 (7 = 7+); 0 = absent (repeat of a counted game, or an older build).
//                             Reuses gamesBetweenAds' slot, which mp rows never carry; no report reads double9.
//   blob20   skipStage        reward_skipped / reward_bonus_skipped rows only: "skipStage:offer" | "skipStage:ad"
//                             (ad = an ad was shown and closed without the reward before the offer was skipped).
//                             Reuses the free detail slot; absent (empty) on older builds.
//   --- 0.57 experiment context + segment summary (no new columns, schema stays 3). The three ifx*
//   fields share ONE slot per field on every row family that carries them, chosen among doubles that
//   none of those families uses for another meaning (always filter on blob1 first):
//   double10 ifxCap           interstitial_checkpoint / _continuation rows: the participant's session cap (1..3; 0 = not a participant)
//   double11 ifxVersion       the same rows + session_summary: the experiment version (1..1000000; 0 = not a participant)
//   double12 ifxCell          1-based position in INTERSTITIAL_CELL_IDS (A=1 .. F=6; 0 = not a participant) on
//                             interstitial_checkpoint / _continuation, the reward_* offer funnel (Classic result
//                             offer experiment block), game_completed and session_summary rows
//   blob19   nextOutcome      game_completed rows only (Classic game after a checkpoint): shown | not_ready |
//                             show_failed | suppressed | control | control_suppressed; "" = no context.
//                             Reuses the outcome slot, which a game_completed row never carries.
//   session_summary rows (one per foreground play segment with >= 1 completed Classic game; Android only):
//   blob18 arm                treatment | control            (generic arm slot)
//   double2  classicGames     1..99                          double3  checkpoints   0..99
//   double4  shown            0..99                          double5  notReady      0..99
//   double6  secondReached    0 | 1                          double7  rewardedShown 0..99
//   double8  rewardedDeferred 0..99                          double9  cadence       5..20 (effective; gamesBetweenAds' slot)
//   double10 cap              1..3 (effective; ifxCap's slot) double11 ifxVersion / double12 ifxCell as above
//   double13 batchSize, double14..19 = 0 (no economy context), double20 = 1 - the generic slots 1 / 13 / 20 are unchanged.
// coinSink / coinSource / milestone ride in blob20 detail (DETAIL_PARAMS). Only the
// balance BUCKET is ever written - never a balance.
// Booleans are 1/0 and absent numbers are 0, so always filter on blob1 before reading
// a double. Counts must use sum(_sample_interval), never count(): AE samples at write
// time even at low volume (the probe stored 21 rows for a 200-point burst).

import { canonicalEventName, normalizeCountry } from "./analyticsDO";
import { AD_LATENCY_BUCKETS, AD_LOAD_SOURCES, REWARDED_TAP_STATES, enumPosition } from "../src/services/ads/adDiagnostics";
import { INTERSTITIAL_CELL_IDS } from "../src/services/ads/interstitialConfigSchema";
import { normalizeAnalyticsPlatform, normalizeAppVersion, normalizeAppVersionCode } from "../src/services/analyticsSchema";
import { checkedEnvelopes, parseIngest, type CheckedEnvelope, type ParsedIngest } from "./analyticsIngest";
import { normalizeAttribution } from "../src/services/analyticsAttribution";
import { normalizeAnalyticsAudience } from "../src/services/analyticsUsage";
import { BALANCE_BUCKETS, GAMES_BUCKETS, NEXT_TARGETS, SHORTFALL_BUCKETS, bucketPosition } from "../src/services/economyBuckets";

export const AE_SCHEMA_VERSION = 3;

/**
 * The index is a random bucket, "b00".."b63", drawn per data point.
 *
 * AE samples at write time "if data points are written too quickly into one index",
 * and a batch lands up to 50 points in the same instant - exactly the burst the probe
 * saw sampled 200 -> 21. Spreading points across buckets keeps each index's rate low.
 *
 * An installation-derived index would spread load too, and was rejected: it would put
 * a stable per-device key (hashed or not, it links every event of one player for the
 * 3-month retention) into a store that needs none - distinct installations and
 * sessions are already counted, privately, by AnalyticsDO's usage sets. A random
 * bucket buys the same sampling benefit with no identifier at all. The trade-off is
 * that AE cannot count distinct players, which is intended.
 */
export const AE_INDEX_BUCKETS = 64;

type ShadowPath = "/event" | "/events";

/** The shape writeDataPoint() takes, restated so tests need no workers-types runtime. */
export type ShadowDataPoint = { blobs: string[]; doubles: number[]; indexes: string[] };

/** Bounded enum params, first match wins. Every one is a closed set in analyticsSchema. */
const DETAIL_PARAMS = ["difficulty", "phase", "tutorialType", "productType", "rarity", "surface", "installAge", "newRank", "coinSink", "coinSource", "milestone", "cause", "notReadyCause", "skipStage"] as const;

/** The schema-2 doubles (14..20) for one accepted envelope's params: economy context (0 when absent) + the reserved sampleWeight (1). */
export function economyDoubles(params: Record<string, unknown>): number[] {
  const hasOffer = typeof params.adAvailable === "boolean";
  const flags = hasOffer ? 1 + (params.adAvailable ? 1 : 0) + (params.adClosesGap === true ? 2 : 0) : 0;
  const coins = typeof params.coinsEarned === "number" ? params.coinsEarned : typeof params.baseReward === "number" ? params.baseReward : 0;
  const target = bucketPosition(NEXT_TARGETS, params.nextTarget);
  const shortfall = bucketPosition(SHORTFALL_BUCKETS, params.shortfallBucket);
  return [
    bucketPosition(BALANCE_BUCKETS, params.balanceBucket),
    target > 0 && shortfall > 0 ? target * 10 + shortfall : 0,
    params.multiplier === 1 || params.multiplier === 2 || params.multiplier === 3 ? params.multiplier : 0,
    flags,
    coins,
    bucketPosition(GAMES_BUCKETS, params.gamesBucket),
    1, // sampleWeight: reserved, unsampled
  ];
}

const FUNNEL = new Set(["game_started", "game_completed", "result_shared"]);

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function modeFor(eventName: string, params: Record<string, unknown>): string {
  if (eventName.startsWith("mp_")) return "multiplayer";
  if (eventName.startsWith("pp_")) return "twoPlayers";
  if (eventName === "game_mode_selected") return str(params.mode);
  if (eventName.startsWith("social_")) return str(params.source);
  if (FUNNEL.has(eventName)) return params.gameType === "playTogether" ? "multiplayer" : "classic";
  if (eventName.startsWith("shape_") || eventName.startsWith("interstitial_") || eventName === "session_summary") return "classic";
  return "";
}

function detailFor(params: Record<string, unknown>): string {
  for (const key of DETAIL_PARAMS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return `${key}:${value}`;
  }
  return "";
}

/** One accepted envelope -> one data point, or null exactly when AnalyticsDO's ingestOne would reject it. */
function toDataPoint(checked: CheckedEnvelope, route: string, country: string, batchSize: number, random: () => number): ShadowDataPoint | null {
  const { eventName, params } = checked;
  if (eventName === null || params === null) return null;
  const b = checked.envelope as Record<string, unknown>;

  const attribution = b?.attribution === undefined ? undefined : normalizeAttribution(b.attribution);
  const gameType = FUNNEL.has(eventName) ? str(params.gameType) : "";
  const contentKey = FUNNEL.has(eventName) && gameType !== "customChallenge" ? str(params.contentKey) : "";
  const bucket = Math.min(AE_INDEX_BUCKETS - 1, Math.floor(random() * AE_INDEX_BUCKETS));

  const point: ShadowDataPoint = {
    blobs: [
      canonicalEventName(eventName),
      route,
      country,
      normalizeAnalyticsPlatform(b?.platform),
      normalizeAppVersion(b?.appVersion),
      normalizeAppVersionCode(b?.appVersionCode),
      normalizeAnalyticsAudience(b?.isInternal),
      modeFor(eventName, params),
      gameType,
      str(params.category),
      contentKey,
      attribution?.source ?? "",
      attribution?.medium ?? "",
      attribution?.campaign ?? "",
      attribution?.content ?? "",
      str(params.placement),
      str(params.reason),
      str(params.arm),
      // Schema 3: reward funnel rows carry no outcome, so this slot holds their interstitialArm.
      // 0.57: game_completed rows carry the next-game context's nextOutcome here (no other row has both).
      str(params.outcome ?? params.interstitialArm ?? params.nextOutcome),
      detailFor(params),
    ],
    doubles: [
      AE_SCHEMA_VERSION,
      num(params.starRating ?? (typeof params.code === "number" ? params.code + 2 : undefined)),
      num(params.passed ?? params.attempt),
      num(params.isNewBest ?? enumPosition(AD_LATENCY_BUCKETS, params.latency)),
      // Schema 3: sessionGames / offerNumber / bonusCoins share these slots on reward rows,
      // which never carry roundCount / roundIndex / amount (see the SCHEMA block above).
      num(params.roundCount ?? params.sessionGames),
      num(params.roundIndex ?? params.offerNumber),
      num(params.playerCount ?? enumPosition(AD_LOAD_SOURCES, params.source)),
      num(params.price ?? enumPosition(REWARDED_TAP_STATES, params.stateAtTap)),
      // 0.57: mp_game_started rows carry mpDailyOrdinal here (no other event has both params).
      num(params.gamesBetweenAds ?? params.mpDailyOrdinal),
      // 0.57: ifxCap on interstitial rows, which carry neither amount nor bonusCoins.
      num(params.amount ?? params.bonusCoins ?? params.ifxCap),
      // 0.57: ifxVersion (interstitial rows, session_summary) - submitted belongs to mp_/pp_round rows only.
      num(params.submitted ?? params.ifxVersion),
      // 0.57: ifxCell as a 1-based position - hadCache belongs to daily_shape_fallback only.
      num(params.hadCache ?? enumPosition(INTERSTITIAL_CELL_IDS, params.ifxCell)),
      batchSize,
      ...economyDoubles(params),
    ],
    indexes: [`b${String(bucket).padStart(2, "0")}`],
  };
  if (eventName === "session_summary") applySessionSummaryDoubles(point.doubles, params);
  return point;
}

/**
 * session_summary has its own explicit double layout (see the SCHEMA block): the generic mapping reads
 * params by the names OTHER events use, none of which a summary carries. Slots 1, 13 and 14..20 are left as
 * the generic code wrote them (schema version, batch size, no economy context, sampleWeight 1).
 */
function applySessionSummaryDoubles(doubles: number[], params: Record<string, unknown>): void {
  doubles[1] = num(params.classicGames);
  doubles[2] = num(params.checkpoints);
  doubles[3] = num(params.shown);
  doubles[4] = num(params.notReady);
  doubles[5] = num(params.secondReached);
  doubles[6] = num(params.rewardedShown);
  doubles[7] = num(params.rewardedDeferred);
  doubles[8] = num(params.cadence);
  doubles[9] = num(params.cap);
  doubles[10] = num(params.ifxVersion);
  doubles[11] = enumPosition(INTERSTITIAL_CELL_IDS, params.ifxCell);
}

/**
 * Pure: the data points AnalyticsDO-acceptable envelopes in this body map to. Empty for
 * anything the DO would reject as a whole (size, JSON, batch shape); invalid entries
 * inside an otherwise valid batch are skipped, as the DO skips them.
 */
export function buildShadowDataPoints(path: ShadowPath, bodyText: string, rawCountry: unknown, random: () => number = Math.random): ShadowDataPoint[] {
  return buildShadowDataPointsFromParsed(parseIngest(path, bodyText), rawCountry, random);
}

/** The same, from a body the caller has already parsed once (analyticsIngest.ts) - no second JSON.parse. */
export function buildShadowDataPointsFromParsed(parsed: ParsedIngest, rawCountry: unknown, random: () => number = Math.random): ShadowDataPoint[] {
  if (parsed.envelopes === null) return [];
  const country = normalizeCountry(rawCountry);
  const route = parsed.path === "/event" ? "event" : "events";
  const batchSize = parsed.path === "/event" ? 1 : parsed.envelopes.length;
  const points: ShadowDataPoint[] = [];
  for (const checked of checkedEnvelopes(parsed)) {
    const point = toDataPoint(checked, route, country, batchSize, random);
    if (point) points.push(point);
  }
  return points;
}

/** Just the method the shadow write needs, so tests can pass a plain object. */
export type ShadowDataset = { writeDataPoint(point: ShadowDataPoint): void };

/**
 * Best-effort write. Never throws, never blocks on I/O (writeDataPoint is fire-and-
 * forget), and returns only a count for tests - the ingest path ignores it.
 */
export function writeAnalyticsShadow(dataset: ShadowDataset | undefined, path: ShadowPath, bodyText: string, rawCountry: unknown): number {
  if (!dataset) return 0;
  try {
    return writeAnalyticsShadowParsed(dataset, parseIngest(path, bodyText), rawCountry);
  } catch {
    return 0;
  }
}

/** Best-effort write from an already-parsed body. Same never-throws contract as above. */
export function writeAnalyticsShadowParsed(dataset: ShadowDataset | undefined, parsed: ParsedIngest, rawCountry: unknown): number {
  if (!dataset) return 0;
  try {
    const points = buildShadowDataPointsFromParsed(parsed, rawCountry);
    for (const point of points) dataset.writeDataPoint(point);
    return points.length;
  } catch {
    return 0;
  }
}
