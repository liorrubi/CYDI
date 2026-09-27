/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Exact-event de-duplication by client eventId (AnalyticsDO).
//
// Why: a batching client keeps exact events in a localStorage outbox until the server
// answers. On Android the WebView commits localStorage to disk ~0.5-2 s late, so a
// process killed right after a send comes back with the "already sent" state lost and
// resends the batch (Phase 3 Stage-0, 27 Sep 2026: 5 app_opens counted twice). The
// client cannot close that window; the server counts each eventId once instead.
//
// Contract:
//  - `eventId` is optional. A missing or malformed one means "no id": the envelope is
//    counted exactly as before. Every client up to 0.53.x sends none.
//  - A valid id (24 lowercase hex) seen within the retention window is a duplicate: not
//    counted again, still a normal 2xx answer.
//  - Seen ids are stored as one string per Israel day (`seen:<date>`, ids concatenated,
//    24 chars each) in the SAME multi-key put as the counters they guard, so a count
//    and its seen mark are persisted together or not at all.
//  - Retention is DEDUP_RETENTION_DAYS Israel days (today included). Older days are
//    deleted lazily on the next load, tracked by the `seen:days` index key.
//  - A day that reaches MAX_SEEN_IDS_PER_DAY stops recording (fail-open: its later
//    events are counted without dedup) so a value never nears the 2 MB storage limit.

export const EVENT_ID_LENGTH = 24;
const EVENT_ID_RE = /^[0-9a-f]{24}$/;
export const DEDUP_RETENTION_DAYS = 7;
/** 60k ids = 1.44 MB per day key, under the 2 MB SQLite-backed value limit. Peak today ~4.1k/day. */
export const MAX_SEEN_IDS_PER_DAY = 60_000;
export const SEEN_INDEX_KEY = "seen:days";

export const seenStorageKey = (dateKey: string): string => `seen:${dateKey}`;

/** The envelope's eventId if it is a valid one, else null ("no id" - counted as today). */
export function normalizeEventId(value: unknown): string | null {
  return typeof value === "string" && EVENT_ID_RE.test(value) ? value : null;
}

/** True when `id` is one of the 24-char ids concatenated in `ids` (aligned match only). */
export function containsEventId(ids: string, id: string): boolean {
  for (let i = ids.indexOf(id); i !== -1; i = ids.indexOf(id, i + 1)) {
    if (i % EVENT_ID_LENGTH === 0) return true;
  }
  return false;
}

/** The oldest Israel date key still inside the retention window that ends on `todayKey`. */
export function retentionCutoff(todayKey: string, days = DEDUP_RETENTION_DAYS): string {
  const [y, m, d] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
}
