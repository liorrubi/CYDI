/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Remote-controllable client analytics settings (Phase 3) - the CLIENT side of the contract.
//
// DELIVERY (the server side belongs to the analytics-protection session and is NOT built
// here): the Worker may attach a response header to /api/analytics/events responses -
//
//   x-cydi-analytics-client: {"v":1,"telemetryKeepPercent":10,"diagnosticKeepPercent":5,
//                              "maxBatchEvents":50,"flushIntervalMs":120000,
//                              "exactFlushDelayMs":20000,"telemetryDisabled":false,
//                              "exactRetryOnNetworkError":false,"ttlSeconds":86400}
//
// A header on a response the client already receives costs ZERO extra Worker requests
// (a GET endpoint would cost one per launch). Until the server sends it, or whenever it is
// missing, malformed or expired, the client uses SAFE DEFAULTS below. Every field is
// optional and clamped into a safe range, so a bad value can never make the client
// send more requests than the defaults allow, bigger batches than the Worker accepts,
// or retry in a loop.

export type AnalyticsClientConfig = {
  /** % of sessions whose telemetry is sent. 100 = no client sampling (the default). */
  telemetryKeepPercent: number;
  /** % of sessions whose diagnostics are sent (nested inside telemetry sessions). */
  diagnosticKeepPercent: number;
  /** Events per request. The Worker validates up to 50 (worker/analyticsDO.ts MAX_BATCH_EVENTS). */
  maxBatchEvents: number;
  /** Serialized request-body cap. Below the Worker's 76,800 and the browser's 64 KiB keepalive limit. */
  maxBatchBytes: number;
  /** Longest a telemetry event waits before its batch is sent (unless the app backgrounds first). */
  flushIntervalMs: number;
  /** Longest an EXACT event waits - shorter, so business facts are not held for the full interval. */
  exactFlushDelayMs: number;
  /** Emergency: drop all telemetry and diagnostics on the client; exact events still go. */
  telemetryDisabled: boolean;
  /** Retry exact events after a network error. Off until the server de-duplicates by eventId. */
  exactRetryOnNetworkError: boolean;
};

export const SAFE_DEFAULTS: Readonly<AnalyticsClientConfig> = Object.freeze({
  telemetryKeepPercent: 100,
  diagnosticKeepPercent: 100,
  maxBatchEvents: 50,
  maxBatchBytes: 60_000,
  flushIntervalMs: 120_000,
  exactFlushDelayMs: 20_000,
  telemetryDisabled: false,
  exactRetryOnNetworkError: false,
});

export const CONFIG_HEADER = "x-cydi-analytics-client";
const STORAGE_KEY = "cydi.analyticsClientConfig.v1";
const MAX_TTL_SECONDS = 7 * 86400;
const DEFAULT_TTL_SECONDS = 86400;

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Parses a header/stored value into a full config. Null when it is not a v1 object at all. */
export function parseClientConfig(raw: unknown): AnalyticsClientConfig | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || v === null || Array.isArray(v) || (v as { v?: unknown }).v !== 1) return null;
  const c = v as Record<string, unknown>;
  return {
    telemetryKeepPercent: clamp(c.telemetryKeepPercent, 0, 100, SAFE_DEFAULTS.telemetryKeepPercent),
    diagnosticKeepPercent: clamp(c.diagnosticKeepPercent, 0, 100, SAFE_DEFAULTS.diagnosticKeepPercent),
    maxBatchEvents: clamp(c.maxBatchEvents, 1, 50, SAFE_DEFAULTS.maxBatchEvents),
    maxBatchBytes: clamp(c.maxBatchBytes, 4_000, 60_000, SAFE_DEFAULTS.maxBatchBytes),
    flushIntervalMs: clamp(c.flushIntervalMs, 10_000, 600_000, SAFE_DEFAULTS.flushIntervalMs),
    exactFlushDelayMs: clamp(c.exactFlushDelayMs, 2_000, 120_000, SAFE_DEFAULTS.exactFlushDelayMs),
    telemetryDisabled: c.telemetryDisabled === true,
    exactRetryOnNetworkError: c.exactRetryOnNetworkError === true,
  };
}

let active: AnalyticsClientConfig = { ...SAFE_DEFAULTS };
let loaded = false;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The config in force: the last valid, unexpired remote value, else the safe defaults. */
export function getClientConfig(now: number = Date.now()): AnalyticsClientConfig {
  if (!loaded) {
    loaded = true;
    try {
      const stored = storage()?.getItem(STORAGE_KEY);
      if (stored) {
        const s = JSON.parse(stored) as { config?: unknown; expiresAt?: unknown };
        const cfg = parseClientConfig(s.config);
        if (cfg && typeof s.expiresAt === "number" && s.expiresAt > now) active = cfg;
      }
    } catch {
      active = { ...SAFE_DEFAULTS };
    }
  }
  return active;
}

/** Applies a header value from an analytics response. Invalid/missing input changes nothing. */
export function applyConfigHeader(headerValue: string | null | undefined, now: number = Date.now()): boolean {
  if (!headerValue) return false;
  const cfg = parseClientConfig(headerValue);
  if (!cfg) return false;
  let ttl = DEFAULT_TTL_SECONDS;
  try {
    const t = (JSON.parse(headerValue) as { ttlSeconds?: unknown }).ttlSeconds;
    if (typeof t === "number" && Number.isFinite(t)) ttl = Math.min(MAX_TTL_SECONDS, Math.max(60, t));
  } catch {
    /* already parsed above */
  }
  active = cfg;
  loaded = true;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ config: cfg, expiresAt: now + ttl * 1000 }));
  } catch {
    /* storage full / blocked: the in-memory value still applies for this run */
  }
  return true;
}

export function _resetClientConfigForTests(): void {
  active = { ...SAFE_DEFAULTS };
  loaded = false;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
