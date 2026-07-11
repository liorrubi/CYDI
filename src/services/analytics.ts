// Single call surface every screen/service must use for custom in-game analytics -
// never call a provider SDK (GA4, Firebase, Cloudflare, ...) directly. Today ships
// with zero real providers registered (no GA4/Firebase project exists yet), so every
// trackEvent call is a no-op in production until a future provider calls
// registerAnalyticsProvider(...) - adding Android/GA4/Firebase later means writing
// one adapter here, not touching any call site.
//
// Cloudflare Web Analytics (general site metrics: visits, referrers, performance) is
// unrelated to this file - it's a beacon script loaded in index.html that Cloudflare
// auto-tracks on its own, with no custom-event API to plug into.

export type AnalyticsEventName =
  | "app_open"
  | "shape_completed"
  | "purchase_completed"
  | "mega_card_unlocked"
  | "artist_pack_link_clicked";

export type AnalyticsParams = Record<string, string | number | boolean>;

type AnalyticsProvider = {
  name: string;
  trackEvent(eventName: AnalyticsEventName, params: AnalyticsParams): void;
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

function sanitizeParams(params: AnalyticsParams): AnalyticsParams {
  const clean: AnalyticsParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (DENYLISTED_PARAM_KEYS.has(normalizeKey(key))) continue;
    clean[key] = typeof value === "string" ? value.slice(0, MAX_PARAM_STRING_LENGTH) : value;
  }
  return clean;
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
  return !import.meta.env.DEV || isDebugFlagOn();
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

if (isDebugFlagOn()) {
  registerAnalyticsProvider(consoleDebugProvider);
}

export function trackEvent(eventName: AnalyticsEventName, params: AnalyticsParams = {}): void {
  if (!isAnalyticsEnabled()) return;
  const safeParams = sanitizeParams(params);
  for (const provider of providers.values()) {
    try {
      provider.trackEvent(eventName, safeParams);
    } catch (error) {
      console.warn(`Analytics provider "${provider.name}" failed`, error);
    }
  }
}
