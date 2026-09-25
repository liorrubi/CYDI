/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// One parse, one validation pass, per analytics ingest request.
//
// The Worker used to JSON.parse the same body up to three times on one request - once
// for the Analytics Engine shadow, once in the shed decision, once for the Phase 2 split -
// and validated each envelope twice. On the Free plan's 10 ms CPU budget, with p99.9
// already near 8-9 ms, that is the part worth removing. Everything here reproduces the
// exact semantics the three callers had:
//
//  - `json` is JSON.parse of the whole body, attempted REGARDLESS of size, because that is
//    what the shed decision always did (an unparseable body forwards unchanged).
//  - `envelopes` is non-null only for a body AnalyticsDO would accept as a whole: same
//    size caps, `/event` = one envelope, `/events` = 1..MAX_BATCH_EVENTS envelopes. That is
//    what the AE shadow and the ledger split always required.
//  - `checkedEnvelopes()` runs the DO's own per-envelope acceptance (isAnalyticsEventName +
//    validateEventParams) once, memoized on the parsed object.

import { isAnalyticsEventName, validateEventParams, type AnalyticsEventName } from "../src/services/analyticsSchema";
import { MAX_BATCH_BODY_BYTES, MAX_BATCH_EVENTS, MAX_BODY_BYTES } from "./analyticsDO";

export type IngestPath = "/event" | "/events";

/** Distinguishes "the body is not JSON" from any value JSON can produce, including null. */
export const UNPARSEABLE: unique symbol = Symbol("unparseable");

export type CheckedEnvelope = {
  envelope: unknown;
  /** Non-null exactly when AnalyticsDO's ingestOne would accept this envelope. */
  eventName: AnalyticsEventName | null;
  params: Record<string, unknown> | null;
};

export type ParsedIngest = {
  path: IngestPath;
  bodyText: string;
  json: unknown | typeof UNPARSEABLE;
  envelopes: unknown[] | null;
  checked?: CheckedEnvelope[];
};

export function parseIngest(path: IngestPath, bodyText: string): ParsedIngest {
  let json: unknown | typeof UNPARSEABLE = UNPARSEABLE;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = UNPARSEABLE;
  }
  const limit = path === "/events" ? MAX_BATCH_BODY_BYTES : MAX_BODY_BYTES;
  let envelopes: unknown[] | null = null;
  if (bodyText && bodyText.length <= limit && json !== UNPARSEABLE) {
    if (path === "/event") envelopes = [json];
    else {
      const events = (json as { events?: unknown } | null)?.events;
      if (Array.isArray(events) && events.length > 0 && events.length <= MAX_BATCH_EVENTS) envelopes = events;
    }
  }
  return { path, bodyText, json, envelopes };
}

/** The DO's per-envelope acceptance, computed once per request. Empty when the body is rejected whole. */
export function checkedEnvelopes(parsed: ParsedIngest): CheckedEnvelope[] {
  if (parsed.checked) return parsed.checked;
  parsed.checked = (parsed.envelopes ?? []).map((envelope) => {
    const name = (envelope as { eventName?: unknown } | null)?.eventName;
    if (!isAnalyticsEventName(name)) return { envelope, eventName: null, params: null };
    const validated = validateEventParams(name, (envelope as { params?: unknown }).params);
    return validated.valid
      ? { envelope, eventName: name, params: validated.params as unknown as Record<string, unknown> }
      : { envelope, eventName: null, params: null };
  });
  return parsed.checked;
}
