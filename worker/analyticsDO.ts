import {
  ANALYTICS_EVENT_NAMES,
  datesInRange,
  isAnalyticsEventName,
  isValidDateKey,
  israelDateKey,
  monthlyRange,
  normalizeAnalyticsPlatform,
  validateEventParams,
  weeklyRange,
  type AnalyticsEventName,
  type AnalyticsPlatform,
} from "../src/services/analyticsSchema";

// Single global Durable Object instance (see worker/index.ts's forwardToAnalyticsDO,
// same pattern as DailyChallengeDO) so every /event write is processed one at a time -
// no read-modify-write races between concurrent players incrementing the same counter.
// Storage holds ONLY running totals, never a per-event record: every write path below
// does `counters.x += 1; storage.put(key, counters)`, never `storage.put(uniqueKey, event)`.

const MAX_BODY_BYTES = 1024;
const FUNNEL_EVENTS = new Set<AnalyticsEventName>(["game_started", "game_completed", "result_shared"]);
// Round results carrying a score: the plain one and its SEO-practice twin, which is
// aggregated separately on purpose so the report's averageScore/passRate (computed
// from shape_completed alone) stay a real-play baseline.
const SCORED_EVENTS = new Set<AnalyticsEventName>(["shape_completed", "shape_practice_completed"]);
// Hard cap for period=range so a single report read stays one multi-key storage get
// (Durable Object storage allows up to 128 keys per get; a month is plenty for the admin page).
const MAX_RANGE_DAYS = 31;

type EventCounters = {
  total: number;
  // Android app vs. website, for every event (the split is only ever 3-4 keys, so
  // unlike byContentKey it costs nothing to keep on all of them). Absent on day
  // buckets recorded before this field existed; events from app versions that
  // predate it land under "unknown" rather than being guessed into a platform.
  byPlatform?: Record<string, number>;
  byGameType?: Record<string, number>;
  byCategory?: Record<string, number>;
  byContentKey?: Record<string, number>;
  // shape_completed only - running sum of starRating and count of passed===true,
  // so the report can derive an average score / pass rate. Absent on day buckets
  // recorded before this field existed; merges treat that as 0, not "unknown".
  sumStarRating?: number;
  passedCount?: number;
  // Count of shape_completed events that actually contributed to sumStarRating/
  // passedCount - NOT the same as `total`, which also includes events recorded
  // before these fields existed. Using `total` as the averaging denominator would
  // silently dilute averageScore/passRate with pre-existing history that has no
  // matching numerator. This is the correct denominator for both.
  scoredCount?: number;
};

type AllCounters = Partial<Record<AnalyticsEventName, EventCounters>>;

type Env = {
  ANALYTICS_ADMIN_TOKEN?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** Report responses are admin-only, token-gated data that changes with every event - they must never be cached by the browser or any intermediary. */
function jsonNoStore(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function incrementKeyMap(map: Record<string, number> | undefined, key: string): Record<string, number> {
  const next = { ...(map ?? {}) };
  next[key] = (next[key] ?? 0) + 1;
  return next;
}

function mergeKeyMaps(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!a && !b) return undefined;
  const merged: Record<string, number> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) merged[k] = (merged[k] ?? 0) + v;
  return merged;
}

/** Only game_started/game_completed/result_shared (the funnel the report computes rates from) get gameType/category/contentKey breakdowns - no breakdown is invented for the other 5 events, which just get a total. */
function incrementEvent(
  counters: AllCounters,
  eventName: AnalyticsEventName,
  params: Record<string, unknown>,
  platform: AnalyticsPlatform,
): AllCounters {
  const existing = counters[eventName] ?? { total: 0 };
  const updated: EventCounters = { ...existing, total: existing.total + 1 };
  updated.byPlatform = incrementKeyMap(existing.byPlatform, platform);
  if (FUNNEL_EVENTS.has(eventName)) {
    const gameType = params.gameType as string;
    const category = params.category as string;
    const contentKey = params.contentKey as string;
    updated.byGameType = incrementKeyMap(existing.byGameType, gameType);
    updated.byCategory = incrementKeyMap(existing.byCategory, category);
    // customChallenge content keys are close to unique-per-creator - breaking them out
    // would let someone correlate started->completed->shared back to one specific
    // person's content, so they're excluded from this breakdown (still counted above).
    if (gameType !== "customChallenge") {
      updated.byContentKey = incrementKeyMap(existing.byContentKey, contentKey);
    }
  }
  if (SCORED_EVENTS.has(eventName)) {
    const starRating = params.starRating as number;
    const passed = params.passed as boolean;
    updated.sumStarRating = (existing.sumStarRating ?? 0) + starRating;
    updated.passedCount = (existing.passedCount ?? 0) + (passed ? 1 : 0);
    updated.scoredCount = (existing.scoredCount ?? 0) + 1;
  }
  return { ...counters, [eventName]: updated };
}

function mergeOptionalSum(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function mergeCounters(a: AllCounters, b: AllCounters): AllCounters {
  const merged: AllCounters = { ...a };
  for (const eventName of ANALYTICS_EVENT_NAMES) {
    const be = b[eventName];
    if (!be) continue;
    const ae = merged[eventName] ?? { total: 0 };
    merged[eventName] = {
      total: ae.total + be.total,
      byPlatform: mergeKeyMaps(ae.byPlatform, be.byPlatform),
      byGameType: mergeKeyMaps(ae.byGameType, be.byGameType),
      byCategory: mergeKeyMaps(ae.byCategory, be.byCategory),
      byContentKey: mergeKeyMaps(ae.byContentKey, be.byContentKey),
      sumStarRating: mergeOptionalSum(ae.sumStarRating, be.sumStarRating),
      passedCount: mergeOptionalSum(ae.passedCount, be.passedCount),
      scoredCount: mergeOptionalSum(ae.scoredCount, be.scoredCount),
    };
  }
  return merged;
}

/** Constant-time string compare for the admin token check - avoids leaking the token via response-time differences. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class AnalyticsDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private dayStorageKey(dateKey: string): string {
    return `day:${dateKey}`;
  }

  private async recordDayIndex(dateKey: string): Promise<void> {
    const days = (await this.state.storage.get<string[]>("days")) ?? [];
    if (days.includes(dateKey)) return;
    days.push(dateKey);
    days.sort();
    await this.state.storage.put("days", days);
  }

  /** Validates the whole event first; only touches storage (and only then) if it's fully valid - no partial save. */
  private async handleEvent(body: unknown): Promise<Response> {
    const b = body as Record<string, unknown> | null;
    const eventName = b?.eventName;
    if (!isAnalyticsEventName(eventName)) return json({ error: "invalid event" }, 400);

    const validated = validateEventParams(eventName, b?.params);
    if (!validated.valid) return json({ error: "invalid params" }, 400);
    const params = validated.params as unknown as Record<string, unknown>;
    // Coerced to a closed set, and never rejected: an event from an older client
    // that sends no platform is still recorded, just as "unknown".
    const platform = normalizeAnalyticsPlatform(b?.platform);

    const dateKey = israelDateKey(Date.now());
    const [alltime, dayCounters] = await Promise.all([
      this.state.storage.get<AllCounters>("alltime"),
      this.state.storage.get<AllCounters>(this.dayStorageKey(dateKey)),
    ]);

    const updatedAlltime = incrementEvent(alltime ?? {}, eventName, params, platform);
    const updatedDay = incrementEvent(dayCounters ?? {}, eventName, params, platform);

    await Promise.all([
      this.state.storage.put("alltime", updatedAlltime),
      this.state.storage.put(this.dayStorageKey(dateKey), updatedDay),
      this.recordDayIndex(dateKey),
    ]);

    return json({ ok: true });
  }

  /** One batched multi-key read of every stored day bucket in the range, keyed back by date. Report ranges are at most MAX_RANGE_DAYS / a calendar month (<=31 keys), well under Durable Object storage's 128-key limit for a single multi-key get. */
  private async readDayBuckets(startDate: string, endDate: string): Promise<Map<string, AllCounters>> {
    const days = (await this.state.storage.get<string[]>("days")) ?? [];
    const inRange = days.filter((day) => day >= startDate && day <= endDate);
    const byDate = new Map<string, AllCounters>();
    if (inRange.length === 0) return byDate;

    const buckets = await this.state.storage.get<AllCounters>(inRange.map((day) => this.dayStorageKey(day)));
    for (const day of inRange) {
      const bucket = buckets.get(this.dayStorageKey(day));
      if (bucket) byDate.set(day, bucket);
    }
    return byDate;
  }

  private mergeDayBuckets(byDate: Map<string, AllCounters>): AllCounters {
    let merged: AllCounters = {};
    for (const bucket of byDate.values()) {
      merged = mergeCounters(merged, bucket);
    }
    return merged;
  }

  private buildReport(
    period: "daily" | "weekly" | "monthly" | "range" | "alltime",
    startDate: string,
    endDate: string,
    counts: AllCounters,
  ) {
    const gameStarted = counts.game_started?.total ?? 0;
    const gameCompleted = counts.game_completed?.total ?? 0;
    const resultShared = counts.result_shared?.total ?? 0;
    const shapeCompleted = counts.shape_completed;
    // Denominator is scoredCount, NOT total - total also includes shape_completed
    // events recorded before sumStarRating/passedCount existed, which would
    // otherwise dilute both rates with history that has no matching numerator.
    const scoredCount = shapeCompleted?.scoredCount ?? 0;
    // null (not 0) when there's nothing to average yet, or when this range predates
    // scoredCount existing - lets the admin page show "no data" instead of a
    // misleading 0.
    const averageScore = scoredCount > 0 && shapeCompleted ? (shapeCompleted.sumStarRating ?? 0) / scoredCount : null;
    const passRate = scoredCount > 0 && shapeCompleted ? (shapeCompleted.passedCount ?? 0) / scoredCount : null;
    return {
      period,
      startDate,
      endDate,
      counts,
      completionRate: gameStarted > 0 ? gameCompleted / gameStarted : 0,
      shareRate: gameCompleted > 0 ? resultShared / gameCompleted : 0,
      averageScore,
      passRate,
    };
  }

  /** Arbitrary rolling window (max MAX_RANGE_DAYS), optionally with a per-day series for charts - the admin page's "last 7/30 days" views. Reads the same day buckets the calendar periods already use; nothing new is stored. */
  private async handleRangeReport(url: URL): Promise<Response> {
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return jsonNoStore({ error: "invalid range" }, 400);
    const dates = datesInRange(start, end);
    if (dates.length > MAX_RANGE_DAYS) return jsonNoStore({ error: "range too long" }, 400);

    const byDate = await this.readDayBuckets(start, end);
    const report = this.buildReport("range", start, end, this.mergeDayBuckets(byDate));
    if (url.searchParams.get("series") === "1") {
      // Every requested date appears exactly once, zero-filled when nothing was
      // recorded, so chart clients never have to reconstruct missing days.
      return jsonNoStore({ ...report, days: dates.map((date) => ({ date, counts: byDate.get(date) ?? {} })) });
    }
    return jsonNoStore(report);
  }

  /** The running since-launch totals ("alltime" bucket) that ingestion has always maintained - startDate reports the first day that ever recorded an event. */
  private async handleAlltimeReport(): Promise<Response> {
    const [counts, days] = await Promise.all([
      this.state.storage.get<AllCounters>("alltime"),
      this.state.storage.get<string[]>("days"),
    ]);
    const today = israelDateKey(Date.now());
    const startDate = days?.[0] ?? today;
    return jsonNoStore(this.buildReport("alltime", startDate, today, counts ?? {}));
  }

  private async handleReport(url: URL, authHeader: string | null): Promise<Response> {
    const token = this.env.ANALYTICS_ADMIN_TOKEN;
    if (!token || !authHeader || !timingSafeEqual(authHeader, `Bearer ${token}`)) {
      return jsonNoStore({ error: "unauthorized" }, 401);
    }

    const period = url.searchParams.get("period") ?? "daily";
    if (period === "range") return this.handleRangeReport(url);
    if (period === "alltime") return this.handleAlltimeReport();
    if (period !== "daily" && period !== "weekly" && period !== "monthly") return jsonNoStore({ error: "invalid period" }, 400);

    const dateParam = url.searchParams.get("date") ?? israelDateKey(Date.now());
    if (!isValidDateKey(dateParam)) return jsonNoStore({ error: "invalid date" }, 400);

    let startDate: string;
    let endDate: string;
    if (period === "daily") {
      startDate = dateParam;
      endDate = dateParam;
    } else if (period === "weekly") {
      ({ startDate, endDate } = weeklyRange(dateParam));
    } else {
      ({ startDate, endDate } = monthlyRange(dateParam));
    }

    const byDate = await this.readDayBuckets(startDate, endDate);
    return jsonNoStore(this.buildReport(period, startDate, endDate, this.mergeDayBuckets(byDate)));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/event" && request.method === "POST") {
      const bodyText = await request.text();
      if (!bodyText || bodyText.length > MAX_BODY_BYTES) return json({ error: "invalid payload" }, 400);
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      return this.handleEvent(body);
    }

    if (url.pathname === "/report" && request.method === "GET") {
      return this.handleReport(url, request.headers.get("authorization"));
    }

    return json({ error: "not found" }, 404);
  }
}
