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

export type UsageIdSets = { installations: string[]; sessions: string[] };
/** Keyed by `${audience}|${platform}` - a flat map keeps the whole day in one storage value (one get, one put). */
export type UsageBucket = { segments: Record<string, UsageIdSets>; truncated?: boolean };

export function emptyUsageBucket(): UsageBucket {
  return { segments: {} };
}

export function usageSegmentKey(audience: AnalyticsAudience, platform: AnalyticsPlatform): string {
  return `${audience}|${platform}`;
}

function segmentAudience(key: string): string {
  return key.split("|")[0] ?? "";
}

function segmentPlatform(key: string): string {
  return key.split("|")[1] ?? "unknown";
}

function totalIds(bucket: UsageBucket, pick: (sets: UsageIdSets) => string[]): number {
  let count = 0;
  for (const sets of Object.values(bucket.segments)) count += pick(sets).length;
  return count;
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
): UsageBucket {
  const key = usageSegmentKey(audience, platform);
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

  return {
    audience,
    ...platformSummary(installations, sessions, totals.gamesStarted, totals.gamesCompleted),
    byPlatform,
    truncated: bucket.truncated === true,
  };
}
