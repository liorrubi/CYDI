/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Server-side math for the installation/session envelope that analytics events now
// carry (see analyticsIdentity.ts for where those ids come from). Lives in src/ and is
// imported by worker/analyticsDO.ts, exactly like analyticsSchema.ts already is - it
// must stay free of DOM, Capacitor and `import.meta.env`, which don't exist in workerd.
//
// What is stored per day: nothing but two flat lists of RANDOM ids per
// audience+platform segment, used solely to answer "how many distinct installations /
// sessions", plus the game counters that already existed. No event is stored per id,
// no id is ever joined to anything, no IP or personal field is involved anywhere.

import {
  ATTRIBUTION_OTHER,
  ATTRIBUTION_UNKNOWN,
  type Attribution,
  type AttributionDimension,
} from "./analyticsAttribution";
import type { AnalyticsPlatform } from "./analyticsSchema";

/** Real players vs. our own devices (QA, development, demos). Kept in physically separate storage buckets so a test round can never land in the real-player numbers. */
export const ANALYTICS_AUDIENCES = ["external", "internal"] as const;
export type AnalyticsAudience = (typeof ANALYTICS_AUDIENCES)[number];
/** Report-only selector: "all" merges both audiences (the pre-split meaning of the numbers), and is never a storage bucket. */
export type AudienceFilter = AnalyticsAudience | "all";

export function isAudienceFilter(value: unknown): value is AudienceFilter {
  return value === "external" || value === "internal" || value === "all";
}

/** Anything other than a literal `true` is a real player - an older client that sends no flag at all is external, never internal. */
export function normalizeAnalyticsAudience(isInternal: unknown): AnalyticsAudience {
  return isInternal === true ? "internal" : "external";
}

// Deliberately wider than the 12-char ids the current client generates, so a future
// id-length change doesn't need a Worker deploy first. Hex only, hard length cap:
// a hostile client cannot use this field to store arbitrary text server-side.
const ID_PATTERN = /^[0-9a-f]{8,32}$/;

/** Returns the id only if it is a plausible anonymous id; null (= "not counted") for missing/garbage values from old or hostile clients. */
export function normalizeAnalyticsId(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

// Per-DAY caps across all segments of one day bucket, so a single storage value can
// never approach Durable Object storage's per-value size limit even under a traffic
// spike or a flood of forged ids. At the game's current volume these are ~30x
// headroom; when a cap is hit the day is marked `truncated` so the report can say
// "at least N" instead of silently under-reporting.
export const MAX_INSTALLATION_IDS_PER_DAY = 1500;
export const MAX_SESSION_IDS_PER_DAY = 3000;

// Attribution values come from a URL anyone can type, so the number of distinct
// SEGMENTS a day can hold is capped as hard as the number of ids. Past the cap a new
// combination still records its ids, but under the ATTRIBUTION_OTHER labels - so the
// audience/platform totals (the numbers that existed before attribution) stay exact
// no matter what a hostile client sends, and only the campaign breakdown degrades.
// Real traffic uses a handful: one platform x a few sources x one or two campaigns.
export const MAX_USAGE_SEGMENTS = 64;

export type UsageIdSets = { installations: string[]; sessions: string[] };
/** Keyed by `${audience}|${platform}|${source}|${campaign}|${content}` - a flat map keeps the whole day in one storage value (one get, one put). Buckets written before attribution existed hold two-part keys and are read as "unknown" on the three new fields; they are never re-attributed. */
export type UsageBucket = { segments: Record<string, UsageIdSets>; truncated?: boolean };

export function emptyUsageBucket(): UsageBucket {
  return { segments: {} };
}

/** Attribution is optional so a caller that does not have one (and every pre-attribution call site) produces the "unknown" segment rather than a differently-shaped key. */
export function usageSegmentKey(audience: AnalyticsAudience, platform: AnalyticsPlatform, attribution?: Attribution): string {
  const source = attribution?.source ?? ATTRIBUTION_UNKNOWN;
  const campaign = attribution?.campaign ?? ATTRIBUTION_UNKNOWN;
  const content = attribution?.content ?? ATTRIBUTION_UNKNOWN;
  return `${audience}|${platform}|${source}|${campaign}|${content}`;
}

function segmentAudience(key: string): string {
  return key.split("|")[0] ?? "";
}

function segmentPlatform(key: string): string {
  return key.split("|")[1] ?? "unknown";
}

// Index in the segment key for each attribution dimension, in the order
// usageSegmentKey writes them. A legacy two-part key has none of these, so every
// lookup falls back to "unknown" rather than reading undefined into a counter key.
const SEGMENT_DIMENSION_INDEX: Record<AttributionDimension, number> = { source: 2, campaign: 3, content: 4 };

function segmentDimension(key: string, dimension: AttributionDimension): string {
  return key.split("|")[SEGMENT_DIMENSION_INDEX[dimension]] ?? ATTRIBUTION_UNKNOWN;
}

function totalIds(bucket: UsageBucket, pick: (sets: UsageIdSets) => string[]): number {
  let count = 0;
  for (const sets of Object.values(bucket.segments)) count += pick(sets).length;
  return count;
}

/**
 * The segment this event belongs in, degraded to the ATTRIBUTION_OTHER labels when
 * the day has already reached MAX_USAGE_SEGMENTS distinct segments.
 *
 * An existing segment is always reused - the cap only ever blocks the creation of a
 * NEW one, so a campaign that was already being counted today keeps being counted
 * exactly, and only genuinely new combinations fold into the overflow bucket.
 */
function segmentKeyWithinCap(
  bucket: UsageBucket,
  audience: AnalyticsAudience,
  platform: AnalyticsPlatform,
  attribution?: Attribution,
): string {
  const key = usageSegmentKey(audience, platform, attribution);
  if (key in bucket.segments) return key;
  if (Object.keys(bucket.segments).length < MAX_USAGE_SEGMENTS) return key;
  // Audience and platform are preserved on purpose: those totals predate attribution
  // and must stay exact even when the campaign breakdown is saturated.
  return usageSegmentKey(audience, platform, {
    source: ATTRIBUTION_OTHER,
    medium: ATTRIBUTION_OTHER,
    campaign: ATTRIBUTION_OTHER,
    content: ATTRIBUTION_OTHER,
    term: ATTRIBUTION_OTHER,
  });
}

/**
 * Adds this event's installation/session ids to the day's bucket.
 *
 * Returns the SAME object when there is nothing new to store (the overwhelmingly
 * common case: an id already seen today, or a cap already reached), so the caller can
 * skip the storage write entirely instead of rewriting the whole bucket per event.
 */
export function recordUsageIds(
  bucket: UsageBucket,
  audience: AnalyticsAudience,
  platform: AnalyticsPlatform,
  installationId: string | null,
  sessionId: string | null,
  attribution?: Attribution,
): UsageBucket {
  const key = segmentKeyWithinCap(bucket, audience, platform, attribution);
  const existing = bucket.segments[key] ?? { installations: [], sessions: [] };

  const addInstallation = installationId !== null && !existing.installations.includes(installationId);
  const addSession = sessionId !== null && !existing.sessions.includes(sessionId);
  if (!addInstallation && !addSession) return bucket;

  const installationsFull = addInstallation && totalIds(bucket, (s) => s.installations) >= MAX_INSTALLATION_IDS_PER_DAY;
  const sessionsFull = addSession && totalIds(bucket, (s) => s.sessions) >= MAX_SESSION_IDS_PER_DAY;
  const storeInstallation = addInstallation && !installationsFull;
  const storeSession = addSession && !sessionsFull;
  if (!storeInstallation && !storeSession) {
    return bucket.truncated ? bucket : { ...bucket, truncated: true };
  }

  const updated: UsageBucket = {
    ...bucket,
    segments: {
      ...bucket.segments,
      [key]: {
        installations: storeInstallation ? [...existing.installations, installationId as string] : existing.installations,
        sessions: storeSession ? [...existing.sessions, sessionId as string] : existing.sessions,
      },
    },
  };
  if (installationsFull || sessionsFull) updated.truncated = true;
  return updated;
}

/** Unions two days' id lists so a multi-day range counts a returning installation once, not once per day. */
export function mergeUsageBuckets(a: UsageBucket, b: UsageBucket): UsageBucket {
  const segments: Record<string, UsageIdSets> = {};
  for (const key of new Set([...Object.keys(a.segments), ...Object.keys(b.segments)])) {
    const left = a.segments[key] ?? { installations: [], sessions: [] };
    const right = b.segments[key] ?? { installations: [], sessions: [] };
    segments[key] = {
      installations: [...new Set([...left.installations, ...right.installations])],
      sessions: [...new Set([...left.sessions, ...right.sessions])],
    };
  }
  const merged: UsageBucket = { segments };
  if (a.truncated || b.truncated) merged.truncated = true;
  return merged;
}

/** The games-started/completed side of the summary, read out of the counters the DO already keeps for the same audience. */
export type UsageGameTotals = {
  gamesStarted: number;
  gamesCompleted: number;
  gamesStartedByPlatform: Record<string, number>;
  gamesCompletedByPlatform: Record<string, number>;
  /**
   * Per attribution dimension, the same two counts keyed by that dimension's value -
   * read out of the counter maps the Durable Object already keeps, so no new storage.
   *
   * Optional, and absent rather than empty for a range that predates attribution: a
   * source row then reports its real installations/sessions with zero games, which is
   * the truth, instead of claiming games it cannot attribute.
   */
  gamesByAttribution?: Partial<Record<AttributionDimension, { started: Record<string, number>; completed: Record<string, number> }>>;
};

export type UsagePlatformSummary = {
  installations: number;
  sessions: number;
  gamesStarted: number;
  gamesCompleted: number;
  /** null (never 0) when there is no installation/session to divide by - same "no data" convention as averageScore/passRate. */
  gamesStartedPerInstallation: number | null;
  gamesCompletedPerInstallation: number | null;
  gamesStartedPerSession: number | null;
  gamesCompletedPerSession: number | null;
};

export type UsageSummary = UsagePlatformSummary & {
  audience: AudienceFilter;
  byPlatform: Record<string, UsagePlatformSummary>;
  /**
   * Where the visits came from. `bySource.youtube` is the headline answer to "did the
   * Short drive traffic"; byCampaign/byContent split that by utm_campaign and
   * utm_content (for CYDI, the individual video).
   *
   * These rows are NOT mutually exclusive across a multi-day range: one installation
   * that arrives from YouTube on Monday and returns directly on Tuesday is counted in
   * both `bySource.youtube` and `bySource.direct`, so the rows can sum to more than
   * the range total. Within a single session an installation has exactly one
   * attribution, so a daily report does not overlap.
   */
  bySource: Record<string, UsagePlatformSummary>;
  byCampaign: Record<string, UsagePlatformSummary>;
  byContent: Record<string, UsagePlatformSummary>;
  /** A per-day id cap was hit somewhere in this range: installations/sessions are a floor, not an exact count. */
  truncated: boolean;
};

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function platformSummary(installations: number, sessions: number, gamesStarted: number, gamesCompleted: number): UsagePlatformSummary {
  return {
    installations,
    sessions,
    gamesStarted,
    gamesCompleted,
    gamesStartedPerInstallation: ratio(gamesStarted, installations),
    gamesCompletedPerInstallation: ratio(gamesCompleted, installations),
    gamesStartedPerSession: ratio(gamesStarted, sessions),
    gamesCompletedPerSession: ratio(gamesCompleted, sessions),
  };
}

/**
 * Distinct installations/sessions for one audience (or both, for "all"), overall and
 * split by platform, next to that audience's game counts.
 *
 * Counting is per platform first and summed afterwards, so a single physical person
 * who plays on both the website and the app shows up once per surface - matching how
 * the ids are actually created (one per browser/install, never one per human).
 */
export function summarizeUsage(bucket: UsageBucket, audience: AudienceFilter, totals: UsageGameTotals): UsageSummary {
  const byPlatform: Record<string, UsagePlatformSummary> = {};
  // Only platforms this audience actually appears on - an audience's summary never
  // carries an all-zero row for a platform that only the OTHER audience used.
  const platforms = new Set<string>([
    ...Object.keys(bucket.segments)
      .filter((key) => audience === "all" || segmentAudience(key) === audience)
      .map(segmentPlatform),
    ...Object.keys(totals.gamesStartedByPlatform),
    ...Object.keys(totals.gamesCompletedByPlatform),
  ]);

  let installations = 0;
  let sessions = 0;
  for (const platform of platforms) {
    const installationIds = new Set<string>();
    const sessionIds = new Set<string>();
    for (const [key, sets] of Object.entries(bucket.segments)) {
      if (segmentPlatform(key) !== platform) continue;
      if (audience !== "all" && segmentAudience(key) !== audience) continue;
      for (const id of sets.installations) installationIds.add(id);
      for (const id of sets.sessions) sessionIds.add(id);
    }
    byPlatform[platform] = platformSummary(
      installationIds.size,
      sessionIds.size,
      totals.gamesStartedByPlatform[platform] ?? 0,
      totals.gamesCompletedByPlatform[platform] ?? 0,
    );
    installations += installationIds.size;
    sessions += sessionIds.size;
  }

  const byDimension = (dimension: AttributionDimension): Record<string, UsagePlatformSummary> =>
    summarizeByDimension(bucket, audience, totals, dimension);

  return {
    audience,
    ...platformSummary(installations, sessions, totals.gamesStarted, totals.gamesCompleted),
    byPlatform,
    bySource: byDimension("source"),
    byCampaign: byDimension("campaign"),
    byContent: byDimension("content"),
    truncated: bucket.truncated === true,
  };
}

/**
 * One attribution dimension's rows, built exactly like byPlatform: distinct ids come
 * from the day's segments, game counts from the counter maps.
 *
 * A value that appears in the counters but has no ids (or the reverse) still gets a
 * row, so a source is never silently missing from one side of the funnel.
 */
function summarizeByDimension(
  bucket: UsageBucket,
  audience: AudienceFilter,
  totals: UsageGameTotals,
  dimension: AttributionDimension,
): Record<string, UsagePlatformSummary> {
  const games = totals.gamesByAttribution?.[dimension];
  const values = new Set<string>([
    ...Object.keys(bucket.segments)
      .filter((key) => audience === "all" || segmentAudience(key) === audience)
      .map((key) => segmentDimension(key, dimension)),
    ...Object.keys(games?.started ?? {}),
    ...Object.keys(games?.completed ?? {}),
  ]);

  const rows: Record<string, UsagePlatformSummary> = {};
  for (const value of values) {
    const installationIds = new Set<string>();
    const sessionIds = new Set<string>();
    for (const [key, sets] of Object.entries(bucket.segments)) {
      if (segmentDimension(key, dimension) !== value) continue;
      if (audience !== "all" && segmentAudience(key) !== audience) continue;
      for (const id of sets.installations) installationIds.add(id);
      for (const id of sets.sessions) sessionIds.add(id);
    }
    rows[value] = platformSummary(
      installationIds.size,
      sessionIds.size,
      games?.started[value] ?? 0,
      games?.completed[value] ?? 0,
    );
  }
  return rows;
}
