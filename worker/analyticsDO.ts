import {
  ANALYTICS_EVENT_NAMES,
  datesInRange,
  isAnalyticsEventName,
  isInstallAgeParam,
  isValidDateKey,
  israelDateKey,
  monthlyRange,
  normalizeAnalyticsPlatform,
  normalizeAppBuild,
  normalizeAppVersion,
  validateEventParams,
  weeklyRange,
  type AnalyticsEventName,
  type AnalyticsPlatform,
} from "../src/services/analyticsSchema";
import { isAdFailureReason } from "../src/services/ads/adTypes";
import { ROUND_COUNT_OPTIONS } from "../src/multiplayer/protocol";
import {
  ATTRIBUTION_DIMENSIONS,
  ATTRIBUTION_OTHER,
  normalizeAttribution,
  type Attribution,
  type AttributionDimension,
} from "../src/services/analyticsAttribution";
import {
  emptyUsageBucket,
  isAudienceFilter,
  mergeUsageBuckets,
  normalizeAnalyticsAudience,
  normalizeAnalyticsId,
  recordUsageIds,
  summarizeUsage,
  type AnalyticsAudience,
  type AudienceFilter,
  type UsageBucket,
  type UsageGameTotals,
  type UsageSummary,
} from "../src/services/analyticsUsage";

// Single global Durable Object instance (see worker/index.ts's forwardToAnalyticsDO,
// same pattern as DailyChallengeDO) so every /event write is processed one at a time -
// no read-modify-write races between concurrent players incrementing the same counter.
// Storage holds ONLY running totals, never a per-event record: every write path below
// does `counters.x += 1; storage.put(key, counters)`, never `storage.put(uniqueKey, event)`.

// Storage layout (all keys hold running totals / id sets only, never an event record):
//   day:<date>     external counters   | dayint:<date> internal counters
//   usage:<date>   distinct installation + session ids for that day, per audience+platform
//   alltime / alltime:internal   the same running since-launch totals, per audience
//
// Day buckets written BEFORE the internal/external split existed hold every event of
// that day, internal ones included, and stay exactly as they are - nothing is
// reconstructed or re-attributed backwards. They therefore read as "external", which
// is the same meaning those numbers already had. Only days recorded from here on can
// separate the two.
// Raised from 1024 when the envelope gained `attribution`: five short labels, each
// capped at 32 characters by normalizeAttributionValue, add at most ~200 bytes. The
// limit exists to stop a client posting bulk data, not to police the envelope's own
// growth, and an event that overflowed it would be REJECTED - so the headroom moves
// with the envelope rather than silently costing us the largest events.
const MAX_BODY_BYTES = 1536;
const FUNNEL_EVENTS = new Set<AnalyticsEventName>(["game_started", "game_completed", "result_shared"]);
// The only event that gets a per-BUILD breakdown. One launch counter is enough to
// see which builds are in the field; putting unbounded-cardinality SHAs on every
// event would grow the stored counter maps without limit.
const BUILD_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["app_open"]);
// Round results carrying a score: the plain one and its SEO-practice twin, which is
// aggregated separately on purpose so the report's averageScore/passRate (computed
// from shape_completed alone) stay a real-play baseline.
const SCORED_EVENTS = new Set<AnalyticsEventName>(["shape_completed", "shape_practice_completed"]);
// The web -> Google Play install funnel, and the ONLY events whose `surface` param
// survives ingest. Every other non-funnel event's params are validated and then
// dropped here, which for this pair would have meant a CTR that could never be split
// by surface. Cardinality is safe for the same reason byPlatform's is: the client
// schema's PLAY_STORE_SURFACE_PARAMS is a closed five-value union, re-validated
// server-side before this runs, so the map cannot grow past five keys.
const SURFACE_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["play_store_cta_shown", "play_store_click"]);
// The two rewarded-ad lifecycle events that already carry a `reason`, and the ONLY
// events that get a per-reason breakdown. Without it a failure reads as a bare count
// and cannot be told apart from a timeout, an SDK error or a consent block. Safe for
// the same reason bySurface is: `reason` is AD_FAILURE_REASONS, a closed ten-value
// union re-validated server-side by validateEventParams before this runs, so the map
// cannot grow past ten keys. The offer-funnel twin `reward_ad_failed` is a DIFFERENT
// event that carries only `placement` - it is deliberately not here.
const REASON_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["rewarded_ad_failed", "rewarded_ad_unavailable"]);
// The byInstallAge twin of the line above, and the same bounded-cardinality argument:
// installAge is INSTALL_AGE_PARAMS, a closed five-value union re-validated server-side,
// so this map cannot grow past five keys. Only first_open carries it -
// install_attributed deliberately has no params at all.
const INSTALL_AGE_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["first_open"]);
// Pass & Play length and progress. `roundCount` is the length the players CHOSE
// (ROUND_COUNT_OPTIONS - three values), `roundIndex` how far the game got. Both are
// closed, re-validated server-side by validateEventParams before this runs, so the
// two maps cannot grow past 3 and 15 keys. Only events that already carry the field
// are listed: pp_round_completed has a roundIndex but NO roundCount, so it appears in
// one set and not the other.
//
// Why both: pp_abandoned fires only from the explicit quit confirmation, so it is a
// floor on drop-out, never the whole of it. pp_round_completed.byRoundIndex is what
// shows how many games actually reach round 2, 3, 4... including the players who
// simply close the app and emit nothing.
const ROUND_COUNT_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["pp_game_started", "pp_game_finished", "pp_abandoned"]);
const ROUND_INDEX_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["pp_round_completed", "pp_abandoned"]);
// Coarse country for the rewarded-ad diagnostics, derived SERVER-SIDE from the
// request (see COUNTRY_HEADER below) and never sent by the client. Only the
// two-letter code is kept: no IP, no city, no region, no coordinates, no ASN, and
// nothing else from the Cloudflare request metadata. The code is the country of the
// NETWORK REQUEST as Cloudflare sees it - a VPN reports its exit country, not where
// the person is.
//
// Confined to four events on purpose. The two rewarded ones are the signal; the two
// offer-shown ones are the DENOMINATOR, without which a country that simply has more
// players always looks like it fails more.
const COUNTRY_BREAKOUT_EVENTS = new Set<AnalyticsEventName>([
  "rewarded_ad_unavailable",
  "rewarded_ad_loaded",
  "reward_offer_shown",
  "reward_bonus_offer_shown",
]);
// Country alone says WHERE, reason alone says WHAT - only the pair says whether Iran
// specifically times out while Germany errors. Both halves are closed sets, so the
// combined key cannot be arbitrary.
const COUNTRY_REASON_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["rewarded_ad_unavailable"]);
// Country and app version crossed, because the two existing dimensions are separate
// maps and therefore cannot answer the question that decides whether an Android
// release is needed: are the Iranian failures coming from 0.48.4, from 0.50.0, or
// from both equally? byCountry says where, byAppVersion says which build, neither
// says both. Same four events as byCountry - the two rewarded ones plus the two
// offer-shown denominators, because a version with more players in a country will
// always produce more failures there.
const COUNTRY_VERSION_BREAKOUT_EVENTS = COUNTRY_BREAKOUT_EVENTS;
const COUNTRY_VERSION_REASON_BREAKOUT_EVENTS = COUNTRY_REASON_BREAKOUT_EVENTS;
// appVersion is FORMAT-guarded, not value-guarded (normalizeAppVersion accepts any
// d.d.d), so unlike country and reason it has no closed domain - which is exactly why
// both crossed maps are capped rather than trusted. The cap, not the input, is the
// bound. Overflow uses the same dedicated OTHER as byCountryReason: ZZ means unknown
// COUNTRY, "unknown" means unknown VERSION, OTHER means the map filled up. Three
// different facts, three different keys, never merged.
const MAX_COUNTRY_VERSION_KEYS = 150;
const MAX_COUNTRY_VERSION_REASON_KEYS = 200;
/** The internal header index.ts puts the normalized code in. Not a client contract - anything a client sends under it is re-normalized and, being unvalidatable, lands in UNKNOWN_COUNTRY like any other junk. */
export const COUNTRY_HEADER = "x-cydi-country";
/** Country could not be determined: absent, Cloudflare's XX/T1, or malformed. */
export const UNKNOWN_COUNTRY = "ZZ";
/** Cardinality overflow for byCountryReason - deliberately NOT UNKNOWN_COUNTRY, so "we do not know the country" and "too many distinct keys" stay separate facts. */
const COUNTRY_REASON_OVERFLOW = "OTHER";
// 249 assigned ISO codes x 9 AD_FAILURE_REASONS is 2,241 worst case, which is a real
// fraction of a Durable Object value. Real traffic uses a few dozen, so the cap only
// ever bites under a forged flood.
const MAX_COUNTRY_REASON_KEYS = 150;

/** Two-letter ISO-style code, uppercased; everything else (missing, XX, T1, malformed) becomes UNKNOWN_COUNTRY. */
export function normalizeCountry(value: unknown): string {
  if (typeof value !== "string") return UNKNOWN_COUNTRY;
  const code = value.trim().toUpperCase();
  // T1 (Tor) fails the pattern anyway; named so the intent survives a pattern change.
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return UNKNOWN_COUNTRY;
  return code;
}
/** Highest index any game can reach, derived from the longest option so a new length cannot silently overflow the map. */
const MAX_ROUND_INDEX = Math.max(...ROUND_COUNT_OPTIONS) - 1;

function isRoundCountValue(value: unknown): value is number {
  return typeof value === "number" && (ROUND_COUNT_OPTIONS as readonly number[]).includes(value);
}

function isRoundIndexValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_ROUND_INDEX;
}
// Which events carry a where-did-this-visit-come-from breakdown. Deliberately a short
// list rather than every event (the byPlatform treatment): attribution values are
// caller-controlled, so each event added here multiplies stored keys by the number of
// live campaigns. These four answer everything the campaign reporting asks - arrivals
// (app_open) and the funnel those arrivals did or didn't complete.
const ATTRIBUTION_BREAKOUT_EVENTS = new Set<AnalyticsEventName>([
  "app_open",
  // Android install attribution: these two are the ONLY native events that send an
  // attribution map, and it comes from the Play Install Referrer rather than a landing
  // URL. first_open's bySource is the number the whole mechanism exists to produce -
  // where genuinely new installs came from. See INSTALL_REFERRER_NOTES.md.
  "install_attributed",
  "first_open",
  "game_started",
  "game_completed",
  "result_shared",
]);
// Per-map cardinality cap, the counter-side twin of MAX_USAGE_SEGMENTS. Existing keys
// always keep counting; only a NEW key past the cap folds into ATTRIBUTION_OTHER, so a
// flood of forged campaigns cannot grow one day's storage value without bound.
const MAX_ATTRIBUTION_KEYS = 50;
// Hard cap for period=range so a single report read stays one multi-key storage get
// (Durable Object storage allows up to 128 keys per get; a month is plenty for the admin page).
const MAX_RANGE_DAYS = 31;

/** The stored index of every date that has ever recorded an event. */
const DAYS_KEY = "days";
/**
 * How long counter mutations may sit in memory before the NEXT EVENT writes them out.
 *
 * The trade is linear and deliberate: longer means fewer rows written and a longer
 * window of counters an eviction can lose. 15s puts the loss ceiling at roughly 45
 * events even at the 23 Sep 2026 peak, while cutting rows written by ~90%. It is not
 * tuned any finer than that because the risk, not the saving, is what bounds it.
 */
const FLUSH_INTERVAL_MS = 15_000;
/**
 * Hard ceiling on buffered events regardless of elapsed time, and in practice the
 * binding budget: at yesterday's rate (~1 event/1.3s) five events accumulate in
 * under 7 seconds, well inside the age budget above. So this, not the clock, is what
 * actually decides how much an eviction can cost.
 *
 * Benchmarked at 5 against 10 on 23 Sep 2026. Ten writes 216 rows per 1,000 events
 * and risks up to 9 per eviction; five writes 430 and risks up to 4. The extra rows
 * are affordable - the projection lands at ~41k of the 100k daily cap against ~30k,
 * both far from it - and rows written is not the limit that broke: DO requests are,
 * and they are 1,000 per 1,000 events either way. Spending headroom we have on halving
 * a loss we cannot otherwise bound is the better side of that trade.
 */
const MAX_PENDING_EVENTS = 5;

type EventCounters = {
  total: number;
  // Android app vs. website, for every event (the split is only ever 3-4 keys, so
  // unlike byContentKey it costs nothing to keep on all of them). Absent on day
  // buckets recorded before this field existed; events from app versions that
  // predate it land under "unknown" rather than being guessed into a platform.
  byPlatform?: Record<string, number>;
  // Which release the event came from (APP_VERSION), for every event. Live
  // versions are a handful of keys at a time, like byPlatform, so keeping it on
  // all events costs nothing; the strict format guard in normalizeAppVersion is
  // what stops a hostile client turning this into arbitrary-key storage. Absent
  // on day buckets recorded before this field existed, and events from clients
  // that predate it land under "unknown" rather than being guessed into a release.
  byAppVersion?: Record<string, number>;
  // app_open ONLY - which BUILD (short git SHA) is in the field. Deliberately not
  // kept on every event: SHAs are unbounded cardinality, and one key per build per
  // event would grow these maps without limit. app_open alone answers "which
  // builds are actually running" at a fixed, tiny cost.
  byAppBuild?: Record<string, number>;
  // play_store_cta_shown / play_store_click ONLY - which surface the CTA was seen
  // or clicked on, so the install funnel's CTR can be read per surface. Bounded to
  // the five ids of PLAY_STORE_SURFACE_PARAMS by the schema validation that runs
  // before this. Absent on every other event, and on day buckets recorded before
  // this field existed.
  bySurface?: Record<string, number>;
  // REASON_BREAKOUT_EVENTS only - why a rewarded ad could not be served or shown,
  // so a failure can be diagnosed (timeout vs. sdk_error vs. consent_blocked...)
  // instead of only counted. Bounded to the nine ids of AD_FAILURE_REASONS. Absent
  // on every other event, and on day buckets recorded before this field existed -
  // such a day reports no reason rows at all rather than guessing them.
  byReason?: Record<string, number>;
  // first_open ONLY - how long before the event the Play install began, in the five
  // closed buckets of INSTALL_AGE_PARAMS, re-validated server-side by
  // validateEventParams before this runs, so the map cannot grow past five keys.
  //
  // A DIAGNOSTIC dimension, never proof about an individual event: first_open cannot
  // be exact, because clearing app data drops the local marker while Play-side
  // install metadata is unchanged. Weight in the tail buckets hints that duplicates
  // are happening; it identifies none of them. See INSTALL_REFERRER_NOTES.md.
  byInstallAge?: Record<string, number>;
  // ROUND_COUNT_BREAKOUT_EVENTS / ROUND_INDEX_BREAKOUT_EVENTS only - the Pass & Play
  // game length the players chose, and how far a game got. Bounded to the three ids of
  // ROUND_COUNT_OPTIONS and to 0..MAX_ROUND_INDEX. Absent on every other event, and on
  // day buckets recorded before these fields existed.
  byRoundCount?: Record<string, number>;
  byRoundIndex?: Record<string, number>;
  // COUNTRY_BREAKOUT_EVENTS / COUNTRY_REASON_BREAKOUT_EVENTS only - the coarse country
  // of the request, and for rewarded failures the country paired with the reason.
  // Bounded to the ISO code domain plus UNKNOWN_COUNTRY, and byCountryReason is capped
  // with its own COUNTRY_REASON_OVERFLOW key. Absent on every other event, and on day
  // buckets recorded before these fields existed.
  byCountry?: Record<string, number>;
  byCountryReason?: Record<string, number>;
  // COUNTRY_VERSION_BREAKOUT_EVENTS / COUNTRY_VERSION_REASON_BREAKOUT_EVENTS only -
  // the same country, crossed with the app version, and for failures with the reason
  // too: "IR|0.50.0", "IR|0.50.0|timeout". Capped rather than domain-bounded because
  // appVersion is only format-guarded. Absent on every other event, and on day buckets
  // recorded before these fields existed.
  byCountryAppVersion?: Record<string, number>;
  byCountryAppVersionReason?: Record<string, number>;
  // ATTRIBUTION_BREAKOUT_EVENTS only - where the visit that produced this event came
  // from. `bySource` is the campaign twin of byPlatform; byCampaign/byUtmContent split
  // it further by utm_campaign / utm_content. All three are capped at
  // MAX_ATTRIBUTION_KEYS distinct keys. Absent on every other event, and on day
  // buckets recorded before attribution existed - such a day reports no source rows at
  // all rather than attributing its history to "direct", which would be a guess.
  //
  // Named byUtmContent, not byContent, so it can never be mistaken for byContentKey
  // above - that one is the SHAPE that was drawn, this one is the ad creative.
  bySource?: Record<string, number>;
  byCampaign?: Record<string, number>;
  byUtmContent?: Record<string, number>;
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

/** Everything one report range needs, read in one pass: each audience's day counters plus the range's unioned installation/session ids. */
type RangeBuckets = {
  external: Map<string, AllCounters>;
  internal: Map<string, AllCounters>;
  usage: UsageBucket;
};

/** The game-funnel side of a usage summary, pulled from counters that already exist - no new storage. */
function gameTotals(counts: AllCounters): UsageGameTotals {
  // Left undefined (not {}) when neither funnel event carries an attribution map -
  // a range from before attribution existed then reports source rows with real
  // installations and zero games, rather than implying the games were attributed.
  const started = counts.game_started;
  const completed = counts.game_completed;
  const gamesByAttribution: NonNullable<UsageGameTotals["gamesByAttribution"]> = {};
  for (const dimension of ATTRIBUTION_DIMENSIONS) {
    const field = ATTRIBUTION_COUNTER_FIELD[dimension];
    if (!started?.[field] && !completed?.[field]) continue;
    gamesByAttribution[dimension] = { started: started?.[field] ?? {}, completed: completed?.[field] ?? {} };
  }

  return {
    gamesStarted: started?.total ?? 0,
    gamesCompleted: completed?.total ?? 0,
    gamesStartedByPlatform: started?.byPlatform ?? {},
    gamesCompletedByPlatform: completed?.byPlatform ?? {},
    gamesByAttribution: Object.keys(gamesByAttribution).length > 0 ? gamesByAttribution : undefined,
  };
}

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

/** incrementKeyMap for caller-controlled keys: an already-counted key keeps counting exactly, a new one past the cap is counted under ATTRIBUTION_OTHER instead of being dropped or growing the map. */
function incrementCappedKeyMap(
  map: Record<string, number> | undefined,
  key: string,
  cap: number,
  overflowKey: string = ATTRIBUTION_OTHER,
): Record<string, number> {
  const existing = map ?? {};
  const safeKey = key in existing || Object.keys(existing).length < cap ? key : overflowKey;
  return incrementKeyMap(existing, safeKey);
}

/** The counter map each attribution dimension writes to - one place, so ingestion, merging and reporting cannot drift apart. */
const ATTRIBUTION_COUNTER_FIELD = {
  source: "bySource",
  campaign: "byCampaign",
  content: "byUtmContent",
} as const satisfies Record<AttributionDimension, keyof EventCounters>;

function mergeKeyMaps(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!a && !b) return undefined;
  const merged: Record<string, number> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) merged[k] = (merged[k] ?? 0) + v;
  return merged;
}

/** Only game_started/game_completed/result_shared (the funnel the report computes rates from) get gameType/category/contentKey breakdowns - no breakdown is invented for the other 5 events, which just get a total. */
export function incrementEvent(
  counters: AllCounters,
  eventName: AnalyticsEventName,
  params: Record<string, unknown>,
  platform: AnalyticsPlatform,
  appVersion: string = "unknown",
  appBuild: string = "unknown",
  attribution?: Attribution,
  country: string = UNKNOWN_COUNTRY,
): AllCounters {
  const existing = counters[eventName] ?? { total: 0 };
  const updated: EventCounters = { ...existing, total: existing.total + 1 };
  updated.byPlatform = incrementKeyMap(existing.byPlatform, platform);
  updated.byAppVersion = incrementKeyMap(existing.byAppVersion, appVersion);
  // Campaign breakout - see ATTRIBUTION_BREAKOUT_EVENTS. Skipped entirely when the
  // client sent no attribution, so an older build's events stay shaped exactly as
  // they are today instead of gaining an "unknown" source key.
  if (attribution && ATTRIBUTION_BREAKOUT_EVENTS.has(eventName)) {
    for (const dimension of ATTRIBUTION_DIMENSIONS) {
      const field = ATTRIBUTION_COUNTER_FIELD[dimension];
      updated[field] = incrementCappedKeyMap(existing[field], attribution[dimension], MAX_ATTRIBUTION_KEYS);
    }
  }
  // Build breakout is app_open only - see the byAppBuild note on EventCounters.
  if (BUILD_BREAKOUT_EVENTS.has(eventName)) {
    updated.byAppBuild = incrementKeyMap(existing.byAppBuild, appBuild);
  }
  // Install-funnel surface breakout - see SURFACE_BREAKOUT_EVENTS.
  if (SURFACE_BREAKOUT_EVENTS.has(eventName)) {
    updated.bySurface = incrementKeyMap(existing.bySurface, params.surface as string);
  }
  // Rewarded-ad failure breakout - see REASON_BREAKOUT_EVENTS. The isAdFailureReason
  // guard is belt-and-braces: handleEvent already rejects the whole event when the
  // reason is missing or outside the union, so a stored event always has a valid one.
  // It matters because this function is exported and called directly - a bad value
  // must leave the map untouched rather than open a free-text key.
  if (REASON_BREAKOUT_EVENTS.has(eventName) && isAdFailureReason(params.reason)) {
    updated.byReason = incrementKeyMap(existing.byReason, params.reason);
  }
  if (INSTALL_AGE_BREAKOUT_EVENTS.has(eventName) && isInstallAgeParam(params.installAge)) {
    updated.byInstallAge = incrementKeyMap(existing.byInstallAge, params.installAge);
  }
  // Pass & Play breakouts - see the two sets above. Guarded for the same reason the
  // rewarded one is: this function is exported, so a bad value must leave the map
  // untouched rather than open an unbounded key.
  if (ROUND_COUNT_BREAKOUT_EVENTS.has(eventName) && isRoundCountValue(params.roundCount)) {
    updated.byRoundCount = incrementKeyMap(existing.byRoundCount, String(params.roundCount));
  }
  if (ROUND_INDEX_BREAKOUT_EVENTS.has(eventName) && isRoundIndexValue(params.roundIndex)) {
    updated.byRoundIndex = incrementKeyMap(existing.byRoundIndex, String(params.roundIndex));
  }
  // Country breakouts - see COUNTRY_BREAKOUT_EVENTS. `country` is already normalized by
  // the caller; normalizing again here keeps a direct call (tests, future callers) from
  // opening a key the ingest path could never produce.
  if (COUNTRY_BREAKOUT_EVENTS.has(eventName)) {
    updated.byCountry = incrementKeyMap(existing.byCountry, normalizeCountry(country));
  }
  if (COUNTRY_REASON_BREAKOUT_EVENTS.has(eventName) && isAdFailureReason(params.reason)) {
    updated.byCountryReason = incrementCappedKeyMap(
      existing.byCountryReason,
      `${normalizeCountry(country)}|${params.reason}`,
      MAX_COUNTRY_REASON_KEYS,
      COUNTRY_REASON_OVERFLOW,
    );
  }
  // The crossed pair. `appVersion` arrives already normalized by handleEvent, so an
  // unknown build is the literal "unknown" rather than a missing segment.
  if (COUNTRY_VERSION_BREAKOUT_EVENTS.has(eventName)) {
    updated.byCountryAppVersion = incrementCappedKeyMap(
      existing.byCountryAppVersion,
      `${normalizeCountry(country)}|${appVersion}`,
      MAX_COUNTRY_VERSION_KEYS,
      COUNTRY_REASON_OVERFLOW,
    );
  }
  if (COUNTRY_VERSION_REASON_BREAKOUT_EVENTS.has(eventName) && isAdFailureReason(params.reason)) {
    updated.byCountryAppVersionReason = incrementCappedKeyMap(
      existing.byCountryAppVersionReason,
      `${normalizeCountry(country)}|${appVersion}|${params.reason}`,
      MAX_COUNTRY_VERSION_REASON_KEYS,
      COUNTRY_REASON_OVERFLOW,
    );
  }
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

export function mergeCounters(a: AllCounters, b: AllCounters): AllCounters {
  const merged: AllCounters = { ...a };
  for (const eventName of ANALYTICS_EVENT_NAMES) {
    const be = b[eventName];
    if (!be) continue;
    const ae = merged[eventName] ?? { total: 0 };
    merged[eventName] = {
      total: ae.total + be.total,
      byPlatform: mergeKeyMaps(ae.byPlatform, be.byPlatform),
      // Undefined on either side (a bucket recorded before these fields existed)
      // stays undefined when both are - mergeKeyMaps already handles that, so no
      // legacy bucket gains a phantom key.
      byAppVersion: mergeKeyMaps(ae.byAppVersion, be.byAppVersion),
      byAppBuild: mergeKeyMaps(ae.byAppBuild, be.byAppBuild),
      bySurface: mergeKeyMaps(ae.bySurface, be.bySurface),
      byReason: mergeKeyMaps(ae.byReason, be.byReason),
      byInstallAge: mergeKeyMaps(ae.byInstallAge, be.byInstallAge),
      byRoundCount: mergeKeyMaps(ae.byRoundCount, be.byRoundCount),
      byRoundIndex: mergeKeyMaps(ae.byRoundIndex, be.byRoundIndex),
      byCountry: mergeKeyMaps(ae.byCountry, be.byCountry),
      byCountryReason: mergeKeyMaps(ae.byCountryReason, be.byCountryReason),
      byCountryAppVersion: mergeKeyMaps(ae.byCountryAppVersion, be.byCountryAppVersion),
      byCountryAppVersionReason: mergeKeyMaps(ae.byCountryAppVersionReason, be.byCountryAppVersionReason),
      bySource: mergeKeyMaps(ae.bySource, be.bySource),
      byCampaign: mergeKeyMaps(ae.byCampaign, be.byCampaign),
      byUtmContent: mergeKeyMaps(ae.byUtmContent, be.byUtmContent),
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

  // --- write buffer -------------------------------------------------------
  //
  // Counters used to be read and written on EVERY event: 4 reads and 2-3 writes
  // per `/event`, which at ~50k events/day is ~200k rows read and ~101k rows
  // written - the whole Free-plan budget, spent by one endpoint (23 Sep 2026).
  //
  // Nothing about WHAT is counted changes here; only when it is persisted. The
  // live counters are held in memory, mutated in place by each event, and
  // written out on a timer. Because this is a SINGLE global instance
  // (idFromName("analytics")) there is exactly one writer and no coordination
  // problem - the same property that already made read-modify-write safe.
  //
  // The cost is bounded and deliberate: an eviction or crash loses at most one
  // flush budget of counters. These are aggregate totals, not records, so the
  // failure mode is a slightly low number rather than a missing event.
  //
  // The flush is driven BY THE NEXT EVENT, never by an alarm.
  //
  // An alarm cannot do this job. A Durable Object is evicted from memory a few
  // seconds after its last request, and an armed alarm does NOT keep it resident -
  // the runtime simply re-instantiates it to run the handler, by which point the
  // in-memory buffer died with the previous instance and there is nothing left to
  // write. Verified against workerd on 23 Sep 2026: with a 15s alarm and no
  // in-request flush, a report 11 seconds after the last event returned an empty
  // counter set and storage had never been touched, while RoomDO's alarms - whose
  // state lives in storage, not memory - kept advancing phases normally in the same
  // runtime. An alarm short enough to beat eviction also fires mid-stream and
  // flushes far more often than the budget below, which measured 3x the writes for
  // no benefit. So there is no alarm here; the budgets are the whole mechanism.
  private counterCache = new Map<string, AllCounters>();
  private usageCache = new Map<string, UsageBucket>();
  private days: string[] = [];
  /** Storage keys whose in-memory value is newer than what is stored. */
  private dirty = new Set<string>();
  /** The Israel date every buffered mutation belongs to; see the rollover flush in handleEvent. */
  private bufferDate: string | null = null;
  /**
   * 0 on a fresh instance ON PURPOSE, so the first event after construction writes
   * through immediately. That makes a trickle - one event, then an idle gap long
   * enough to evict - behave exactly like the unbuffered code did, with no loss and
   * no buffering to lose. Buffering only engages once events are actually arriving
   * close together, which is the only case where it saves anything.
   */
  private lastFlushAt = 0;
  private pendingEvents = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Nothing may read a half-loaded buffer: blockConcurrencyWhile holds every
    // request (and the alarm) until the since-launch totals and the day index
    // are in memory. Day/usage buckets are NOT loaded here - there is one per
    // day since launch and only today's is ever written, so they are faulted in
    // on first touch instead.
    state.blockConcurrencyWhile(async () => {
      const [external, internal, days] = await Promise.all([
        state.storage.get<AllCounters>(this.alltimeStorageKey("external")),
        state.storage.get<AllCounters>(this.alltimeStorageKey("internal")),
        state.storage.get<string[]>(DAYS_KEY),
      ]);
      if (external) this.counterCache.set(this.alltimeStorageKey("external"), external);
      if (internal) this.counterCache.set(this.alltimeStorageKey("internal"), internal);
      this.days = days ?? [];
    });
  }

  private dayStorageKey(dateKey: string, audience: AnalyticsAudience): string {
    return audience === "internal" ? `dayint:${dateKey}` : `day:${dateKey}`;
  }

  private usageStorageKey(dateKey: string): string {
    return `usage:${dateKey}`;
  }

  private alltimeStorageKey(audience: AnalyticsAudience): string {
    return audience === "internal" ? "alltime:internal" : "alltime";
  }

  /** The live counters for a key, faulted in from storage exactly once per instance. */
  private async loadCounters(key: string): Promise<AllCounters> {
    const cached = this.counterCache.get(key);
    if (cached !== undefined) return cached;
    const stored = (await this.state.storage.get<AllCounters>(key)) ?? {};
    this.counterCache.set(key, stored);
    return stored;
  }

  private async loadUsage(key: string): Promise<UsageBucket> {
    const cached = this.usageCache.get(key);
    if (cached !== undefined) return cached;
    const stored = (await this.state.storage.get<UsageBucket>(key)) ?? emptyUsageBucket();
    this.usageCache.set(key, stored);
    return stored;
  }

  /** True when the buffer has reached either budget and the current request must write it out. */
  private flushDue(now: number): boolean {
    return this.pendingEvents >= MAX_PENDING_EVENTS || now - this.lastFlushAt >= FLUSH_INTERVAL_MS;
  }

  /**
   * Persist every buffered key in one multi-key put.
   *
   * The dirty set is snapshotted and cleared BEFORE awaiting, so an event that
   * arrives mid-write re-marks its own key and is picked up by the next cycle.
   * That is safe precisely because each entry persists the WHOLE current value
   * rather than a delta: a value mutated during the write is never half-saved,
   * the next flush simply writes the newer whole. A failed put puts the keys
   * back and rethrows, so the runtime retries the alarm instead of silently
   * dropping the buffer.
   */
  private async flush(): Promise<void> {
    if (this.dirty.size === 0) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    const entries: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === DAYS_KEY) entries[key] = this.days;
      else if (this.usageCache.has(key)) entries[key] = this.usageCache.get(key);
      else entries[key] = this.counterCache.get(key);
    }
    try {
      await this.state.storage.put(entries);
    } catch (err) {
      for (const key of keys) this.dirty.add(key);
      throw err;
    }
    this.lastFlushAt = Date.now();
    this.pendingEvents = 0;
  }

  /**
   * Nothing in this object ever arms an alarm (see the write-buffer comment above).
   * The handler is kept only so that an alarm left armed by an earlier version of
   * this code does the right thing when it fires rather than throwing.
   */
  async alarm(): Promise<void> {
    await this.flush();
  }

  /** After a date rollover the previous day's buckets are persisted and no longer needed in memory; the two since-launch totals stay. */
  private pruneDayCaches(currentDate: string): void {
    for (const key of [...this.counterCache.keys()]) {
      if ((key.startsWith("day:") || key.startsWith("dayint:")) && !key.endsWith(`:${currentDate}`)) {
        this.counterCache.delete(key);
      }
    }
    for (const key of [...this.usageCache.keys()]) {
      if (key !== this.usageStorageKey(currentDate)) this.usageCache.delete(key);
    }
  }

  /** Validates the whole event first; only touches storage (and only then) if it's fully valid - no partial save. */
  private async handleEvent(body: unknown, country: string): Promise<Response> {
    const b = body as Record<string, unknown> | null;
    const eventName = b?.eventName;
    if (!isAnalyticsEventName(eventName)) return json({ error: "invalid event" }, 400);

    const validated = validateEventParams(eventName, b?.params);
    if (!validated.valid) return json({ error: "invalid params" }, 400);
    const params = validated.params as unknown as Record<string, unknown>;
    // Coerced to a closed set, and never rejected: an event from an older client
    // that sends no platform is still recorded, just as "unknown". The three
    // identity fields below behave the same way - all optional, all normalized to a
    // safe value, none of them ever a reason to drop an event.
    const platform = normalizeAnalyticsPlatform(b?.platform);
    const audience = normalizeAnalyticsAudience(b?.isInternal);
    const installationId = normalizeAnalyticsId(b?.installationId);
    const sessionId = normalizeAnalyticsId(b?.sessionId);
    // Same contract as the four above: optional, format-guarded, never a reason to
    // drop an event. Both are recorded into whichever audience bucket was selected,
    // so a QA build and a production build of the same release stay comparable.
    const appVersion = normalizeAppVersion(b?.appVersion);
    const appBuild = normalizeAppBuild(b?.appBuild);
    // Same contract once more - optional, coerced to a closed alphabet, never a
    // reason to drop an event. `undefined` (not a normalized "unknown" attribution)
    // when the client sent nothing at all, so the counter breakouts below can tell
    // "this build predates attribution" apart from "this visit was unattributable"
    // and only the second one gets a row.
    const attribution = b?.attribution === undefined ? undefined : normalizeAttribution(b.attribution);

    const dateKey = israelDateKey(Date.now());
    // A buffer must never span two day buckets. Whatever is pending belongs to the
    // previous Israel day, so it is persisted before the first event of the new one
    // is counted - otherwise a flush landing after midnight would be attributed by
    // its own key, which is right, but yesterday's tail would sit unwritten behind
    // today's traffic indefinitely.
    if (this.bufferDate !== null && this.bufferDate !== dateKey) {
      await this.flush();
      this.pruneDayCaches(dateKey);
    }
    this.bufferDate = dateKey;

    const alltimeKey = this.alltimeStorageKey(audience);
    const dayKey = this.dayStorageKey(dateKey, audience);
    const usageKey = this.usageStorageKey(dateKey);
    const [alltime, dayCounters, usage] = await Promise.all([
      this.loadCounters(alltimeKey),
      this.loadCounters(dayKey),
      this.loadUsage(usageKey),
    ]);

    // Identical counter shaping to before - incrementEvent is untouched, and every
    // dimension (platform, app version/build, attribution, country, the crossed
    // country maps, funnel and scored breakouts) is produced exactly as it was.
    this.counterCache.set(alltimeKey, incrementEvent(alltime, eventName, params, platform, appVersion, appBuild, attribution, country));
    this.counterCache.set(dayKey, incrementEvent(dayCounters, eventName, params, platform, appVersion, appBuild, attribution, country));
    this.dirty.add(alltimeKey);
    this.dirty.add(dayKey);

    // Still only when this event actually contributed an id nobody sent today, so a
    // day's id lists are not re-marked dirty by every event that repeats them.
    const updatedUsage = recordUsageIds(usage, audience, platform, installationId, sessionId, attribution);
    if (updatedUsage !== usage) {
      this.usageCache.set(usageKey, updatedUsage);
      this.dirty.add(usageKey);
    }

    if (!this.days.includes(dateKey)) {
      this.days = [...this.days, dateKey].sort();
      this.dirty.add(DAYS_KEY);
    }

    // Durability happens HERE, inside the request, where the runtime's output gating
    // guarantees the write lands before the response does.
    //
    // What this deliberately does not protect: the events buffered since the last
    // boundary, if the stream then stops and the instance is evicted before another
    // event arrives. That tail is at most MAX_PENDING_EVENTS, and it costs something
    // only when the WHOLE app goes quiet - this is one global object aggregating
    // every player, so its stream is near-continuous during active hours. Paying for
    // an alarm to chase that tail costs more DO requests than the tail is worth, and
    // DO requests are the tighter of the two limits.
    this.pendingEvents++;
    if (this.flushDue(Date.now())) await this.flush();
    return json({ ok: true });
  }

  /**
   * Two batched multi-key reads of every stored bucket in the range, keyed back by date:
   * one for the counters (external + internal), one for the usage id sets. A range is at
   * most MAX_RANGE_DAYS / a calendar month (<=31 days), so that's <=62 and <=31 keys -
   * both well under Durable Object storage's 128-key limit for a single multi-key get.
   */
  private async readDayBuckets(startDate: string, endDate: string): Promise<RangeBuckets> {
    // The in-memory index, not the stored one: today's date is added the moment its
    // first event arrives, so a report taken before the first flush of a new day
    // would otherwise not know that day exists at all.
    const inRange = this.days.filter((day) => day >= startDate && day <= endDate);
    const result: RangeBuckets = { external: new Map(), internal: new Map(), usage: emptyUsageBucket() };
    if (inRange.length === 0) return result;

    // Anything already in the buffer is authoritative and is not re-read: the cached
    // value either came from storage or supersedes it.
    const counterKeys = inRange
      .flatMap((day) => [this.dayStorageKey(day, "external"), this.dayStorageKey(day, "internal")])
      .filter((key) => !this.counterCache.has(key));
    const usageKeys = inRange.map((day) => this.usageStorageKey(day)).filter((key) => !this.usageCache.has(key));
    const [counters, usageBuckets] = await Promise.all([
      counterKeys.length > 0 ? this.state.storage.get<AllCounters>(counterKeys) : new Map<string, AllCounters>(),
      usageKeys.length > 0 ? this.state.storage.get<UsageBucket>(usageKeys) : new Map<string, UsageBucket>(),
    ]);

    for (const day of inRange) {
      const externalKey = this.dayStorageKey(day, "external");
      const external = this.counterCache.get(externalKey) ?? counters.get(externalKey);
      if (external) result.external.set(day, external);
      const internalKey = this.dayStorageKey(day, "internal");
      const internal = this.counterCache.get(internalKey) ?? counters.get(internalKey);
      if (internal) result.internal.set(day, internal);
      const usageKey = this.usageStorageKey(day);
      const usage = this.usageCache.get(usageKey) ?? usageBuckets.get(usageKey);
      // Union across days, so an installation that played on three days counts once.
      if (usage) result.usage = mergeUsageBuckets(result.usage, usage);
    }
    return result;
  }

  private mergeDayBuckets(byDate: Map<string, AllCounters>): AllCounters {
    let merged: AllCounters = {};
    for (const bucket of byDate.values()) {
      merged = mergeCounters(merged, bucket);
    }
    return merged;
  }

  /**
   * Selected-audience counts (external by default), plus a usage block for that
   * audience and a side-by-side external/internal usage summary. The two audiences are
   * always reported separately and never summed together unless audience=all was asked
   * for explicitly.
   */
  private buildReport(
    period: "daily" | "weekly" | "monthly" | "range" | "alltime",
    startDate: string,
    endDate: string,
    audience: AudienceFilter,
    counts: AllCounters,
    usage: { selected: UsageSummary; external: UsageSummary; internal: UsageSummary } | null,
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
      audience,
      counts,
      completionRate: gameStarted > 0 ? gameCompleted / gameStarted : 0,
      shareRate: gameCompleted > 0 ? resultShared / gameCompleted : 0,
      averageScore,
      passRate,
      // null for period=alltime only: distinct-id sets are kept per day (and unioned
      // per range), never as a since-launch set, which would grow without bound.
      usage: usage?.selected ?? null,
      usageByAudience: usage ? { external: usage.external, internal: usage.internal } : null,
    };
  }

  /** Counters for the requested audience: one bucket family, or both merged for audience=all. */
  private countsForAudience(buckets: RangeBuckets, audience: AudienceFilter): AllCounters {
    const external = this.mergeDayBuckets(buckets.external);
    const internal = this.mergeDayBuckets(buckets.internal);
    if (audience === "external") return external;
    if (audience === "internal") return internal;
    return mergeCounters(external, internal);
  }

  private usageSummaries(buckets: RangeBuckets, audience: AudienceFilter) {
    const external = summarizeUsage(buckets.usage, "external", gameTotals(this.mergeDayBuckets(buckets.external)));
    const internal = summarizeUsage(buckets.usage, "internal", gameTotals(this.mergeDayBuckets(buckets.internal)));
    const selected =
      audience === "external"
        ? external
        : audience === "internal"
          ? internal
          : summarizeUsage(buckets.usage, "all", gameTotals(this.countsForAudience(buckets, "all")));
    return { selected, external, internal };
  }

  /** Arbitrary rolling window (max MAX_RANGE_DAYS), optionally with a per-day series for charts - the admin page's "last 7/30 days" views. Reads the same day buckets the calendar periods already use; nothing new is stored. */
  private async handleRangeReport(url: URL, audience: AudienceFilter): Promise<Response> {
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return jsonNoStore({ error: "invalid range" }, 400);
    const dates = datesInRange(start, end);
    if (dates.length > MAX_RANGE_DAYS) return jsonNoStore({ error: "range too long" }, 400);

    const buckets = await this.readDayBuckets(start, end);
    const report = this.buildReport(
      "range",
      start,
      end,
      audience,
      this.countsForAudience(buckets, audience),
      this.usageSummaries(buckets, audience),
    );
    if (url.searchParams.get("series") === "1") {
      // Every requested date appears exactly once, zero-filled when nothing was
      // recorded, so chart clients never have to reconstruct missing days. Per-day
      // counts follow the selected audience, same as the totals above.
      const perDay = (date: string): AllCounters => {
        const external = buckets.external.get(date) ?? {};
        const internal = buckets.internal.get(date) ?? {};
        if (audience === "external") return external;
        if (audience === "internal") return internal;
        return mergeCounters(external, internal);
      };
      return jsonNoStore({ ...report, days: dates.map((date) => ({ date, counts: perDay(date) })) });
    }
    return jsonNoStore(report);
  }

  /** The running since-launch totals ("alltime" bucket) that ingestion has always maintained - startDate reports the first day that ever recorded an event. */
  private async handleAlltimeReport(audience: AudienceFilter): Promise<Response> {
    // Buffered values, same reasoning as readDayBuckets: the since-launch totals are
    // held in memory from construction onwards, so reading storage here would report
    // whatever the last flush happened to have written.
    const [external, internal] = await Promise.all([
      this.loadCounters(this.alltimeStorageKey("external")),
      this.loadCounters(this.alltimeStorageKey("internal")),
    ]);
    const today = israelDateKey(Date.now());
    const startDate = this.days[0] ?? today;
    const counts =
      audience === "external" ? external : audience === "internal" ? internal : mergeCounters(external, internal);
    // No usage block here on purpose - see buildReport.
    return jsonNoStore(this.buildReport("alltime", startDate, today, audience, counts, null));
  }

  private async handleReport(url: URL, authHeader: string | null): Promise<Response> {
    const token = this.env.ANALYTICS_ADMIN_TOKEN;
    if (!token || !authHeader || !timingSafeEqual(authHeader, `Bearer ${token}`)) {
      return jsonNoStore({ error: "unauthorized" }, 401);
    }

    // Defaults to real players. Internal (our own QA/dev devices) is only ever
    // returned when asked for by name, and "all" is the only way to see them summed.
    const audienceParam = url.searchParams.get("audience") ?? "external";
    if (!isAudienceFilter(audienceParam)) return jsonNoStore({ error: "invalid audience" }, 400);
    const audience: AudienceFilter = audienceParam;

    const period = url.searchParams.get("period") ?? "daily";
    if (period === "range") return this.handleRangeReport(url, audience);
    if (period === "alltime") return this.handleAlltimeReport(audience);
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

    const buckets = await this.readDayBuckets(startDate, endDate);
    return jsonNoStore(
      this.buildReport(
        period,
        startDate,
        endDate,
        audience,
        this.countsForAudience(buckets, audience),
        this.usageSummaries(buckets, audience),
      ),
    );
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
      return this.handleEvent(body, normalizeCountry(request.headers.get(COUNTRY_HEADER)));
    }

    if (url.pathname === "/report" && request.method === "GET") {
      return this.handleReport(url, request.headers.get("authorization"));
    }

    return json({ error: "not found" }, 404);
  }
}
