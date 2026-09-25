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
// Booleans are 1/0 and absent numbers are 0, so always filter on blob1 before reading
// a double. Counts must use sum(_sample_interval), never count(): AE samples at write
// time even at low volume (the probe stored 21 rows for a 200-point burst).

import { canonicalEventName, MAX_BATCH_BODY_BYTES, MAX_BATCH_EVENTS, MAX_BODY_BYTES, normalizeCountry } from "./analyticsDO";
import {
  isAnalyticsEventName,
  normalizeAnalyticsPlatform,
  normalizeAppVersion,
  normalizeAppVersionCode,
  validateEventParams,
} from "../src/services/analyticsSchema";
import { normalizeAttribution } from "../src/services/analyticsAttribution";
import { normalizeAnalyticsAudience } from "../src/services/analyticsUsage";

export const AE_SCHEMA_VERSION = 1;

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
const DETAIL_PARAMS = ["difficulty", "phase", "tutorialType", "productType", "rarity", "surface", "installAge", "newRank"] as const;

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
  if (eventName.startsWith("shape_") || eventName.startsWith("interstitial_")) return "classic";
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
function toDataPoint(envelope: unknown, route: string, country: string, batchSize: number, random: () => number): ShadowDataPoint | null {
  const b = envelope as Record<string, unknown> | null;
  const eventName = b?.eventName;
  if (!isAnalyticsEventName(eventName)) return null;
  const validated = validateEventParams(eventName, b?.params);
  if (!validated.valid) return null;
  const params = validated.params as unknown as Record<string, unknown>;

  const attribution = b?.attribution === undefined ? undefined : normalizeAttribution(b.attribution);
  const gameType = FUNNEL.has(eventName) ? str(params.gameType) : "";
  const contentKey = FUNNEL.has(eventName) && gameType !== "customChallenge" ? str(params.contentKey) : "";
  const bucket = Math.min(AE_INDEX_BUCKETS - 1, Math.floor(random() * AE_INDEX_BUCKETS));

  return {
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
      str(params.outcome),
      detailFor(params),
    ],
    doubles: [
      AE_SCHEMA_VERSION,
      num(params.starRating),
      num(params.passed),
      num(params.isNewBest),
      num(params.roundCount),
      num(params.roundIndex),
      num(params.playerCount),
      num(params.price),
      num(params.gamesBetweenAds),
      num(params.amount),
      num(params.submitted),
      num(params.hadCache),
      batchSize,
    ],
    indexes: [`b${String(bucket).padStart(2, "0")}`],
  };
}

/**
 * Pure: the data points AnalyticsDO-acceptable envelopes in this body map to. Empty for
 * anything the DO would reject as a whole (size, JSON, batch shape); invalid entries
 * inside an otherwise valid batch are skipped, as the DO skips them.
 */
export function buildShadowDataPoints(path: ShadowPath, bodyText: string, rawCountry: unknown, random: () => number = Math.random): ShadowDataPoint[] {
  const limit = path === "/events" ? MAX_BATCH_BODY_BYTES : MAX_BODY_BYTES;
  if (!bodyText || bodyText.length > limit) return [];
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return [];
  }
  const country = normalizeCountry(rawCountry);

  if (path === "/event") {
    const point = toDataPoint(body, "event", country, 1, random);
    return point ? [point] : [];
  }

  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_BATCH_EVENTS) return [];
  const points: ShadowDataPoint[] = [];
  for (const envelope of events) {
    const point = toDataPoint(envelope, "events", country, events.length, random);
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
    const points = buildShadowDataPoints(path, bodyText, rawCountry);
    for (const point of points) dataset.writeDataPoint(point);
    return points.length;
  } catch {
    return 0;
  }
}
