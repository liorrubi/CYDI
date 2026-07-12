import {
  ANALYTICS_EVENT_NAMES,
  isAnalyticsEventName,
  isValidDateKey,
  israelDateKey,
  monthlyRange,
  validateEventParams,
  weeklyRange,
  type AnalyticsEventName,
} from "../src/services/analyticsSchema";

// Single global Durable Object instance (see worker/index.ts's forwardToAnalyticsDO,
// same pattern as DailyChallengeDO) so every /event write is processed one at a time -
// no read-modify-write races between concurrent players incrementing the same counter.
// Storage holds ONLY running totals, never a per-event record: every write path below
// does `counters.x += 1; storage.put(key, counters)`, never `storage.put(uniqueKey, event)`.

const MAX_BODY_BYTES = 1024;
const FUNNEL_EVENTS = new Set<AnalyticsEventName>(["game_started", "game_completed", "result_shared"]);

type EventCounters = {
  total: number;
  byGameType?: Record<string, number>;
  byCategory?: Record<string, number>;
  byContentKey?: Record<string, number>;
};

type AllCounters = Partial<Record<AnalyticsEventName, EventCounters>>;

type Env = {
  ANALYTICS_ADMIN_TOKEN?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
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
function incrementEvent(counters: AllCounters, eventName: AnalyticsEventName, params: Record<string, unknown>): AllCounters {
  const existing = counters[eventName] ?? { total: 0 };
  const updated: EventCounters = { ...existing, total: existing.total + 1 };
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
  return { ...counters, [eventName]: updated };
}

function mergeCounters(a: AllCounters, b: AllCounters): AllCounters {
  const merged: AllCounters = { ...a };
  for (const eventName of ANALYTICS_EVENT_NAMES) {
    const be = b[eventName];
    if (!be) continue;
    const ae = merged[eventName] ?? { total: 0 };
    merged[eventName] = {
      total: ae.total + be.total,
      byGameType: mergeKeyMaps(ae.byGameType, be.byGameType),
      byCategory: mergeKeyMaps(ae.byCategory, be.byCategory),
      byContentKey: mergeKeyMaps(ae.byContentKey, be.byContentKey),
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

    const dateKey = israelDateKey(Date.now());
    const [alltime, dayCounters] = await Promise.all([
      this.state.storage.get<AllCounters>("alltime"),
      this.state.storage.get<AllCounters>(this.dayStorageKey(dateKey)),
    ]);

    const updatedAlltime = incrementEvent(alltime ?? {}, eventName, params);
    const updatedDay = incrementEvent(dayCounters ?? {}, eventName, params);

    await Promise.all([
      this.state.storage.put("alltime", updatedAlltime),
      this.state.storage.put(this.dayStorageKey(dateKey), updatedDay),
      this.recordDayIndex(dateKey),
    ]);

    return json({ ok: true });
  }

  private async sumRange(startDate: string, endDate: string): Promise<AllCounters> {
    const days = (await this.state.storage.get<string[]>("days")) ?? [];
    let merged: AllCounters = {};
    for (const day of days) {
      if (day < startDate || day > endDate) continue;
      const bucket = await this.state.storage.get<AllCounters>(this.dayStorageKey(day));
      if (bucket) merged = mergeCounters(merged, bucket);
    }
    return merged;
  }

  private buildReport(period: "daily" | "weekly" | "monthly", startDate: string, endDate: string, counts: AllCounters) {
    const gameStarted = counts.game_started?.total ?? 0;
    const gameCompleted = counts.game_completed?.total ?? 0;
    const resultShared = counts.result_shared?.total ?? 0;
    return {
      period,
      startDate,
      endDate,
      counts,
      completionRate: gameStarted > 0 ? gameCompleted / gameStarted : 0,
      shareRate: gameCompleted > 0 ? resultShared / gameCompleted : 0,
    };
  }

  private async handleReport(url: URL, authHeader: string | null): Promise<Response> {
    const token = this.env.ANALYTICS_ADMIN_TOKEN;
    if (!token || !authHeader || !timingSafeEqual(authHeader, `Bearer ${token}`)) {
      return json({ error: "unauthorized" }, 401);
    }

    const period = url.searchParams.get("period") ?? "daily";
    if (period !== "daily" && period !== "weekly" && period !== "monthly") return json({ error: "invalid period" }, 400);

    const dateParam = url.searchParams.get("date") ?? israelDateKey(Date.now());
    if (!isValidDateKey(dateParam)) return json({ error: "invalid date" }, 400);

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

    const counts = await this.sumRange(startDate, endDate);
    return json(this.buildReport(period, startDate, endDate, counts));
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
