// Single call surface every screen/service must use for custom in-game analytics -
// never call a provider SDK (GA4, Firebase, Cloudflare, ...) directly. Every event's
// exact param shape lives in analyticsSchema.ts (shared with the Worker's server-side
// validation) - adding Android/GA4/Firebase later means writing one adapter here, not
// touching any call site.
//
// Cloudflare Web Analytics (general site metrics: visits, referrers, performance) is
// unrelated to this file - it's a beacon script loaded in index.html that Cloudflare
// auto-tracks on its own, with no custom-event API to plug into.

import type { AnalyticsEventName, EventParamsMap } from "./analyticsSchema";

export type { AnalyticsEventName };
export type AnalyticsParams = Record<string, string | number | boolean>;

type AnalyticsProvider = {
  name: string;
  trackEvent<E extends AnalyticsEventName>(eventName: E, params: EventParamsMap[E]): void;
};

const DEBUG_FLAG_KEY = "cydi.analyticsDebug.v1";
const MAX_PARAM_STRING_LENGTH = 100;

// Any param key matching one of these (after lowercasing and stripping non-alphanumeric
// characters, so "playerId", "PlayerID", "player_id" etc. all normalize the same way) is
// dropped from every event, regardless of what a call site tries to send - a real
// runtime safety net against accidentally including identifying information, not just
// caller discipline.
const DENYLISTED_PARAM_KEYS = new Set([
  "name",
  "playername",
  "displayname",
  "username",
  "email",
  "emailaddress",
  "ip",
  "ipaddress",
  "id",
  "playerid",
  "userid",
  "deviceid",
  "clientid",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Exported so tests can prove real content-identifier fields (contentKey/artistKey/
// packKey) survive this denylist unmodified - see analyticsSchema.test.ts.
export function sanitizeParams(params: AnalyticsParams): AnalyticsParams {
  const clean: AnalyticsParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (DENYLISTED_PARAM_KEYS.has(normalizeKey(key))) continue;
    clean[key] = typeof value === "string" ? value.slice(0, MAX_PARAM_STRING_LENGTH) : value;
  }
  return clean;
}

// Rapid-double-click guard: if the exact same event+params fires again within this
// window, it's almost certainly one physical action (double-tap, a retry, React
// StrictMode) rather than two real occurrences. Purely in-memory, never persisted -
// resets on reload, needs no identifier of any kind.
const DUPLICATE_WINDOW_MS = 2000;
const recentEvents = new Map<string, number>();

function eventFingerprint(eventName: string, params: AnalyticsParams): string {
  const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return `${eventName}:${JSON.stringify(sortedEntries)}`;
}

function isDuplicateRecentEvent(eventName: string, params: AnalyticsParams): boolean {
  const key = eventFingerprint(eventName, params);
  const now = Date.now();
  const last = recentEvents.get(key);
  recentEvents.set(key, now);
  // Opportunistic cleanup so this map never grows unbounded across a long session.
  if (recentEvents.size > 200) {
    for (const [k, t] of recentEvents) {
      if (now - t > DUPLICATE_WINDOW_MS) recentEvents.delete(k);
    }
  }
  return last !== undefined && now - last < DUPLICATE_WINDOW_MS;
}

function isDebugFlagOn(): boolean {
  try {
    return localStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Off during `npm run dev` unless the local debug flag is set by hand in devtools; always on in production builds (though a no-op there too until a real provider is registered). */
function isAnalyticsEnabled(): boolean {
  return !isDevBuild() || isDebugFlagOn();
}

// `import.meta.env` is a Vite-ism, statically replaced at build time - it doesn't
// exist when this module is loaded under plain Node (e.g. the test runner importing
// sanitizeParams), so this is wrapped rather than read directly at module scope.
// An environment where it can't be determined at all is treated as "dev" (the safer
// default - it means the network-calling provider never registers itself outside a
// real production Vite build).
function isDevBuild(): boolean {
  try {
    return import.meta.env.DEV;
  } catch {
    return true;
  }
}

// Keyed by provider name so re-registering the same provider (React StrictMode's
// double-invoked effects, Vite HMR re-running module init) replaces the existing
// entry instead of accumulating duplicates that would each fire on every event.
const providers = new Map<string, AnalyticsProvider>();

export function registerAnalyticsProvider(provider: AnalyticsProvider): void {
  providers.set(provider.name, provider);
}

const consoleDebugProvider: AnalyticsProvider = {
  name: "console-debug",
  trackEvent(eventName, params) {
    console.log(`[analytics] ${eventName}`, params);
  },
};

// Ships the event to the game's own Cloudflare Worker (POST /api/analytics/event),
// which validates it against the same per-event schema (analyticsSchema.ts) and rolls
// it into aggregate-only counters server-side - see worker/analyticsDO.ts. Never
// blocks or throws into the caller; analytics must never break gameplay.
const cloudflareAnalyticsProvider: AnalyticsProvider = {
  name: "cloudflare-worker",
  trackEvent(eventName, params) {
    try {
      fetch("/api/analytics/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventName, params }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // fetch unavailable or threw synchronously - swallow, never break gameplay.
    }
  },
};

if (isDebugFlagOn()) {
  registerAnalyticsProvider(consoleDebugProvider);
}
if (!isDevBuild()) {
  registerAnalyticsProvider(cloudflareAnalyticsProvider);
}

export function trackEvent<E extends AnalyticsEventName>(eventName: E, params: EventParamsMap[E]): void {
  if (!isAnalyticsEnabled()) return;
  const rawParams = params as unknown as AnalyticsParams;
  if (isDuplicateRecentEvent(eventName, rawParams)) return;
  const safeParams = sanitizeParams(rawParams) as unknown as EventParamsMap[E];
  for (const provider of providers.values()) {
    try {
      provider.trackEvent(eventName, safeParams);
    } catch (error) {
      console.warn(`Analytics provider "${provider.name}" failed`, error);
    }
  }
}
