/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Hybrid analytics reporting: EXACT events from the AnalyticsDO ledger, TELEMETRY from
// Analytics Engine (dataset cydi_analytics_shadow_v1), in the report's existing shape.
//
// WHY. Since Phase 2 (exactLedger) the DO is a durable exact ledger for EXACT_LEDGER_EVENTS,
// while telemetry in the DO is only the 10% shed sample - and disappears entirely once
// `telemetryToDo` is switched off. Analytics Engine receives every accepted envelope,
// unsampled (the Phase 1 shadow write). So a report that wants full telemetry must read AE.
//
// SOURCE MAP (per report day, Israel dates like every DO bucket):
//  - EXACT_LEDGER_EVENTS and `analytics_requests`: always the DO. Never read from AE, so an
//    event present in both stores is counted exactly once.
//  - every other event (telemetry): AE for days AE fully covers (AE_COVERAGE_START_DATE
//    onwards), the DO for earlier days - the only data that exists for them. The response's
//    `sources` block names the source of every day, so no semantics change silently.
//  - usage installations/sessions: DO distinct-id sets (unchanged). Games in `usage`
//    (and per-source games) are recomputed from the merged counters, i.e. from AE on
//    covered days - a mixed metric, documented in `sources.notes`.
//
// AE counts are always sum(_sample_interval) (AE may sample at write time), never count().
// AE counters mirror the DO's per-event breakouts by construction: the same event sets
// (imported from analyticsDO.ts) decide which breakout maps an event carries.
//
// FAIL-OPEN. Missing token, a failing query, a timeout, a truncated result: the report falls
// back to the DO-only report it has always produced, and says so in `sources`.

import {
  ATTRIBUTION_BREAKOUT_EVENTS,
  COUNTRY_BREAKOUT_EVENTS,
  COUNTRY_GAME_TYPE_BREAKOUT_EVENTS,
  COUNTRY_REASON_BREAKOUT_EVENTS,
  COUNTRY_REASON_OVERFLOW,
  COUNTRY_VERSION_BREAKOUT_EVENTS,
  FUNNEL_EVENTS,
  MAX_ATTRIBUTION_KEYS,
  MAX_COUNTRY_GAME_TYPE_KEYS,
  MAX_COUNTRY_REASON_KEYS,
  MAX_COUNTRY_VERSION_KEYS,
  MAX_COUNTRY_VERSION_REASON_KEYS,
  REASON_BREAKOUT_EVENTS,
  ROUND_COUNT_BREAKOUT_EVENTS,
  ROUND_INDEX_BREAKOUT_EVENTS,
  SCORED_EVENTS,
  SURFACE_BREAKOUT_EVENTS,
  type AllCounters,
  type EventCounters,
} from "./analyticsDO";
import { EXACT_LEDGER_EVENTS } from "./analyticsExactLedger";
import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from "../src/services/analyticsSchema";

export const AE_DATASET = "cydi_analytics_shadow_v1";
/**
 * First Israel day the shadow write captured in full. The write went live 25 Sep 2026 07:37Z
 * (10:37 Israel), so 25 Sep itself is partial and stays on the DO.
 */
export const AE_COVERAGE_START_DATE = "2026-09-26";
/** Per-query row cap; hitting it means the result may be incomplete and the report falls back. */
export const AE_ROW_LIMIT = 50000;

export type AeRow = Record<string, string | number>;
export type AeFetch = (sql: string) => Promise<AeRow[]>;

/**
 * The events whose report counts come from AE on covered days: everything not in the exact ledger.
 * Computed on first use, NOT at module load: analyticsDO <-> analyticsAeReport <-> analyticsExactLedger
 * form an import cycle, and a top-level read of EXACT_LEDGER_EVENTS can run before that module has
 * initialised (a TDZ ReferenceError at startup, depending on which module loads first).
 */
let telemetryEventsCache: readonly AnalyticsEventName[] | null = null;
export function telemetryEvents(): readonly AnalyticsEventName[] {
  return (telemetryEventsCache ??= ANALYTICS_EVENT_NAMES.filter((e) => !EXACT_LEDGER_EVENTS.has(e)));
}

// ------------------------------------------------------------------ Israel days ----

function jerusalemOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((local - utcMs) / 60000);
}

/** UTC instant of 00:00 Israel time on `dateKey` (YYYY-MM-DD), DST-aware. */
export function israelMidnightUtc(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d) - 2 * 3600000;
  for (let i = 0; i < 3; i++) guess = Date.UTC(y, m - 1, d) - jerusalemOffsetMinutes(guess) * 60000;
  return guess;
}

function nextDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = nextDate(d)) out.push(d);
  return out;
}

/** The dates of [start, end] that AE covers, as a UTC window. Null when none are covered. */
export function coveredWindow(start: string, end: string, nowMs: number): { dates: string[]; startMs: number; endMs: number } | null {
  const from = start > AE_COVERAGE_START_DATE ? start : AE_COVERAGE_START_DATE;
  if (from > end) return null;
  const startMs = israelMidnightUtc(from);
  if (startMs > nowMs) return null;
  const endMs = Math.min(israelMidnightUtc(nextDate(end)), nowMs);
  return { dates: datesBetween(from, end).filter((d) => israelMidnightUtc(d) <= nowMs), startMs, endMs };
}

// ------------------------------------------------------------------ SQL ----

const sqlTime = (ms: number) => `toDateTime('${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}')`;
const sqlList = (items: Iterable<string>) => [...items].map((s) => `'${s.replace(/'/g, "")}'`).join(",");
const telemetryIn = (set: ReadonlySet<AnalyticsEventName>) => sqlList(telemetryEvents().filter((e) => set.has(e)));

/**
 * All queries for one report window. Columns: blob1 event, blob3 country, blob4 platform,
 * blob5 appVersion, blob7 audience, blob9 gameType, blob10 category, blob11 contentKey,
 * blob12 source, blob14 campaign, blob15 utm content, blob17 reason, blob20 detail,
 * double2 starRating, double3 passed, double5 roundCount, double6 roundIndex.
 */
/**
 * Events whose platform x app-version mix is reported (`versions`, the admin page's
 * version / rollout view). app_open and first_open are exact-ledger events, so their
 * COUNTS stay the DO's - but their rows ride in the existing `base` query (same query,
 * a few more rows, no extra request) purely so that one source (AE) backs every column
 * of the version view. counter() still refuses exact events, so no total moves.
 */
export const VERSION_MIX_EVENTS = ["app_open", "first_open", "game_started", "game_completed"] as const;
/** Lazy for the same import-cycle reason as telemetryEvents(). */
const versionMixExact = () => VERSION_MIX_EVENTS.filter((e) => EXACT_LEDGER_EVENTS.has(e));

export function buildAeQueries(startMs: number, endMs: number, series: { startMs: number; endMs: number; offsetHours: number }[] = []): Record<string, string> {
  const T = `timestamp >= ${sqlTime(startMs)} AND timestamp < ${sqlTime(endMs)}`;
  const W = `${T} AND blob1 NOT IN (${sqlList(EXACT_LEDGER_EVENTS)})`;
  const q: Record<string, string> = {
    base: `SELECT blob1 AS ev, blob7 AS aud, blob4 AS platform, blob5 AS ver, sum(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${T} AND (blob1 NOT IN (${sqlList(EXACT_LEDGER_EVENTS)}) OR blob1 IN (${sqlList(versionMixExact())})) GROUP BY ev, aud, platform, ver LIMIT ${AE_ROW_LIMIT}`,
    country: `SELECT blob1 AS ev, blob7 AS aud, blob3 AS country, blob5 AS ver, sum(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${W} AND blob1 IN (${telemetryIn(COUNTRY_BREAKOUT_EVENTS)}) GROUP BY ev, aud, country, ver LIMIT ${AE_ROW_LIMIT}`,
    funnel: `SELECT blob1 AS ev, blob7 AS aud, blob9 AS gameType, blob10 AS category, blob11 AS contentKey, sum(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${W} AND blob1 IN (${telemetryIn(FUNNEL_EVENTS)}) GROUP BY ev, aud, gameType, category, contentKey LIMIT ${AE_ROW_LIMIT}`,
    countryGameType: `SELECT blob1 AS ev, blob7 AS aud, blob3 AS country, blob9 AS gameType, sum(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${W} AND blob1 IN (${telemetryIn(COUNTRY_GAME_TYPE_BREAKOUT_EVENTS)}) GROUP BY ev, aud, country, gameType LIMIT ${AE_ROW_LIMIT}`,
    attribution: `SELECT blob1 AS ev, blob7 AS aud, blob12 AS source, blob14 AS campaign, blob15 AS content, sum(_sample_interval) AS n FROM ${AE_DATASET} WHERE ${W} AND blob1 IN (${telemetryIn(ATTRIBUTION_BREAKOUT_EVENTS)}) AND blob12 != '' GROUP BY ev, aud, source, campaign, content LIMIT ${AE_ROW_LIMIT}`,
    detail: `SELECT blob1 AS ev, blob7 AS aud, blob3 AS country, blob5 AS ver, blob17 AS reason, blob20 AS detail, double5 AS roundCount, double6 AS roundIndex, sum(_sample_interval) AS n, sum(double2 * _sample_interval) AS stars, sum(double3 * _sample_interval) AS passed FROM ${AE_DATASET} WHERE ${W} AND blob1 IN (${sqlList(telemetryEvents().filter((e) => REASON_BREAKOUT_EVENTS.has(e) || SURFACE_BREAKOUT_EVENTS.has(e) || ROUND_COUNT_BREAKOUT_EVENTS.has(e) || ROUND_INDEX_BREAKOUT_EVENTS.has(e) || SCORED_EVENTS.has(e) || COUNTRY_REASON_BREAKOUT_EVENTS.has(e)))}) GROUP BY ev, aud, country, ver, reason, detail, roundCount, roundIndex LIMIT ${AE_ROW_LIMIT}`,
  };
  series.forEach((s, i) => {
    q[`series${i}`] = `SELECT toStartOfInterval(timestamp + INTERVAL '${s.offsetHours}' HOUR, INTERVAL '1' DAY) AS day, blob1 AS ev, blob7 AS aud, sum(_sample_interval) AS n FROM ${AE_DATASET} WHERE timestamp >= ${sqlTime(s.startMs)} AND timestamp < ${sqlTime(s.endMs)} AND blob1 NOT IN (${sqlList(EXACT_LEDGER_EVENTS)}) GROUP BY day, ev, aud LIMIT ${AE_ROW_LIMIT}`;
  });
  return q;
}

/** Splits covered dates into runs with one Israel UTC offset each (a DST change splits a range in two). */
export function seriesSegments(dates: string[], endMs: number): { startMs: number; endMs: number; offsetHours: number }[] {
  const segs: { startMs: number; endMs: number; offsetHours: number }[] = [];
  for (const d of dates) {
    const s = israelMidnightUtc(d);
    const e = Math.min(israelMidnightUtc(nextDate(d)), endMs);
    const off = Math.round(jerusalemOffsetMinutes(s + 3600000) / 60);
    const last = segs[segs.length - 1];
    if (last && last.offsetHours === off && last.endMs === s) last.endMs = e;
    else segs.push({ startMs: s, endMs: e, offsetHours: off });
  }
  return segs;
}

// ------------------------------------------------------------------ rows -> counters ----

type Audience = "external" | "internal";
const num = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function bump(map: Record<string, number> | undefined, key: string, n: number): Record<string, number> {
  const out = map ?? {};
  out[key] = (out[key] ?? 0) + n;
  return out;
}

/** DO caps these maps in arrival order; AE has no order, so the largest keys are kept and the rest fold into OTHER. */
function capMap(map: Record<string, number> | undefined, max: number, overflow: string | null): Record<string, number> | undefined {
  if (!map) return map;
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => b[1] - a[1]);
  const kept = Object.fromEntries(entries.slice(0, max - (overflow ? 1 : 0)));
  if (overflow) kept[overflow] = entries.slice(max - 1).reduce((t, [, v]) => t + v, 0);
  return kept;
}

/** "<platform>|<appVersion>" -> event -> weighted count, for VERSION_MIX_EVENTS only. */
export type VersionMix = Record<string, Record<string, number>>;

export type AeTelemetry = {
  counters: Record<Audience, AllCounters>;
  days: Record<string, Record<Audience, AllCounters>>;
  /** The platform x version mix of the whole AE window, from the `base` query's rows. */
  versions: Record<Audience, VersionMix>;
  truncated: boolean;
};

function counter(counters: Record<Audience, AllCounters>, aud: string, ev: string): EventCounters | null {
  if (aud !== "external" && aud !== "internal") return null;
  // Exact events are the DO ledger's alone - never counted from AE, whatever a query returns.
  if (EXACT_LEDGER_EVENTS.has(ev)) return null;
  const c = counters[aud] as Record<string, EventCounters>;
  return (c[ev] ??= { total: 0 });
}

/** Pure: AE query results -> per-audience counters shaped exactly like AnalyticsDO's. */
export function aeRowsToCounters(results: Record<string, AeRow[]>, dateOfDay: (day: string) => string = (d) => d.slice(0, 10)): AeTelemetry {
  const counters: Record<Audience, AllCounters> = { external: {}, internal: {} };
  const days: AeTelemetry["days"] = {};
  const versions: AeTelemetry["versions"] = { external: {}, internal: {} };
  let truncated = false;
  for (const rows of Object.values(results)) if (rows.length >= AE_ROW_LIMIT) truncated = true;

  for (const r of results.base ?? []) {
    const aud = str(r.aud), ev = str(r.ev);
    // The version mix reads the row before counter() gets a say: it is the one place an
    // exact event's AE row is used, and it never feeds a count.
    if ((aud === "external" || aud === "internal") && (VERSION_MIX_EVENTS as readonly string[]).includes(ev)) {
      const key = `${str(r.platform) || "unknown"}|${str(r.ver) || "unknown"}`;
      const cell = (versions[aud][key] ??= {});
      cell[ev] = (cell[ev] ?? 0) + num(r.n);
    }
    const c = counter(counters, aud, ev);
    if (!c) continue;
    const n = num(r.n);
    c.total += n;
    c.byPlatform = bump(c.byPlatform, str(r.platform), n);
    c.byAppVersion = bump(c.byAppVersion, str(r.ver), n);
  }
  for (const r of results.country ?? []) {
    const ev = str(r.ev), c = counter(counters, str(r.aud), ev);
    if (!c) continue;
    const n = num(r.n), country = str(r.country) || "ZZ";
    c.byCountry = bump(c.byCountry, country, n);
    if (COUNTRY_VERSION_BREAKOUT_EVENTS.has(ev as never)) c.byCountryAppVersion = bump(c.byCountryAppVersion, `${country}|${str(r.ver)}`, n);
  }
  for (const r of results.funnel ?? []) {
    const c = counter(counters, str(r.aud), str(r.ev));
    if (!c) continue;
    const n = num(r.n);
    c.byGameType = bump(c.byGameType, str(r.gameType), n);
    c.byCategory = bump(c.byCategory, str(r.category), n);
    if (str(r.gameType) !== "customChallenge" && str(r.contentKey) !== "") c.byContentKey = bump(c.byContentKey, str(r.contentKey), n);
  }
  for (const r of results.countryGameType ?? []) {
    const c = counter(counters, str(r.aud), str(r.ev));
    if (!c || str(r.gameType) === "") continue;
    c.byCountryGameType = bump(c.byCountryGameType, `${str(r.country) || "ZZ"}|${str(r.gameType)}`, num(r.n));
  }
  for (const r of results.attribution ?? []) {
    const c = counter(counters, str(r.aud), str(r.ev));
    if (!c) continue;
    const n = num(r.n);
    c.bySource = bump(c.bySource, str(r.source), n);
    c.byCampaign = bump(c.byCampaign, str(r.campaign), n);
    c.byUtmContent = bump(c.byUtmContent, str(r.content), n);
  }
  for (const r of results.detail ?? []) {
    const ev = str(r.ev), c = counter(counters, str(r.aud), ev);
    if (!c) continue;
    const n = num(r.n), reason = str(r.reason), country = str(r.country) || "ZZ";
    if (REASON_BREAKOUT_EVENTS.has(ev as never) && reason) c.byReason = bump(c.byReason, reason, n);
    if (COUNTRY_REASON_BREAKOUT_EVENTS.has(ev as never) && reason) {
      c.byCountryReason = bump(c.byCountryReason, `${country}|${reason}`, n);
      c.byCountryAppVersionReason = bump(c.byCountryAppVersionReason, `${country}|${str(r.ver)}|${reason}`, n);
    }
    const detail = str(r.detail);
    if (SURFACE_BREAKOUT_EVENTS.has(ev as never) && detail.startsWith("surface:")) c.bySurface = bump(c.bySurface, detail.slice(8), n);
    if (ROUND_COUNT_BREAKOUT_EVENTS.has(ev as never) && num(r.roundCount) > 0) c.byRoundCount = bump(c.byRoundCount, String(num(r.roundCount)), n);
    if (ROUND_INDEX_BREAKOUT_EVENTS.has(ev as never)) c.byRoundIndex = bump(c.byRoundIndex, String(num(r.roundIndex)), n);
    if (SCORED_EVENTS.has(ev as never)) {
      c.sumStarRating = (c.sumStarRating ?? 0) + num(r.stars);
      c.passedCount = (c.passedCount ?? 0) + num(r.passed);
      c.scoredCount = (c.scoredCount ?? 0) + n;
    }
  }
  // Same caps as the DO, so a report reader sees the same map sizes.
  for (const aud of ["external", "internal"] as const) {
    for (const c of Object.values(counters[aud]) as EventCounters[]) {
      c.bySource = capMap(c.bySource, MAX_ATTRIBUTION_KEYS, null);
      c.byCampaign = capMap(c.byCampaign, MAX_ATTRIBUTION_KEYS, null);
      c.byUtmContent = capMap(c.byUtmContent, MAX_ATTRIBUTION_KEYS, null);
      c.byCountryReason = capMap(c.byCountryReason, MAX_COUNTRY_REASON_KEYS, COUNTRY_REASON_OVERFLOW);
      c.byCountryAppVersion = capMap(c.byCountryAppVersion, MAX_COUNTRY_VERSION_KEYS, COUNTRY_REASON_OVERFLOW);
      c.byCountryAppVersionReason = capMap(c.byCountryAppVersionReason, MAX_COUNTRY_VERSION_REASON_KEYS, COUNTRY_REASON_OVERFLOW);
      c.byCountryGameType = capMap(c.byCountryGameType, MAX_COUNTRY_GAME_TYPE_KEYS, COUNTRY_REASON_OVERFLOW);
    }
  }
  for (const [key, rows] of Object.entries(results)) {
    if (!key.startsWith("series")) continue;
    for (const r of rows) {
      const aud = str(r.aud);
      if (aud !== "external" && aud !== "internal") continue;
      if (EXACT_LEDGER_EVENTS.has(str(r.ev))) continue;
      const date = dateOfDay(str(r.day));
      days[date] ??= { external: {}, internal: {} };
      const c = ((days[date][aud] as Record<string, EventCounters>)[str(r.ev)] ??= { total: 0 });
      c.total += num(r.n);
    }
  }
  return { counters, days, versions, truncated };
}

/** A DO day bucket with its telemetry removed: exact events and the request counter stay. */
export function stripTelemetry(counters: AllCounters | undefined): AllCounters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(counters ?? {})) if (k === "analytics_requests" || EXACT_LEDGER_EVENTS.has(k)) out[k] = v;
  return out as AllCounters;
}

// ------------------------------------------------------------------ fetch ----

/** Real AE SQL client. Throws on any non-200 so the caller can fall back. */
export function aeSqlClient(accountId: string, token: string, timeoutMs = 5000): AeFetch {
  return async (query: string) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: query,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`AE SQL HTTP ${res.status}`);
    const body = (await res.json()) as { data?: AeRow[] };
    return body.data ?? [];
  };
}

/** Runs every query in parallel; any failure rejects the whole set (the caller falls back). */
export async function fetchAeTelemetry(query: AeFetch, startMs: number, endMs: number, seriesDates: string[] | null): Promise<AeTelemetry> {
  const segments = seriesDates ? seriesSegments(seriesDates, endMs) : [];
  const queries = buildAeQueries(startMs, endMs, segments);
  const entries = await Promise.all(Object.entries(queries).map(async ([name, sql]) => [name, await query(sql)] as const));
  return aeRowsToCounters(Object.fromEntries(entries));
}
