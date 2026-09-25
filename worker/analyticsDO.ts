import {
  ANALYTICS_EVENT_NAMES,
  datesInRange,
  isAnalyticsEventName,
  isGameType,
  isInstallAgeParam,
  isValidDateKey,
  israelDateKey,
  monthlyRange,
  normalizeAnalyticsPlatform,
  normalizeAppBuild,
  normalizeAppVersionCode,
  normalizeAppVersion,
  validateEventParams,
  weeklyRange,
  type AnalyticsEventName,
  type AnalyticsPlatform,
} from "../src/services/analyticsSchema";
import { isAdFailureReason } from "../src/services/ads/adTypes";
import {
  isInterstitialArm,
  isInterstitialCadence,
  isInterstitialFailureReason,
  isInterstitialOutcome,
} from "../src/services/ads/interstitialConfigSchema";
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
export const MAX_BODY_BYTES = 1536;
/**
 * Batch ingest limits (A4). The client flushes at 10, but the server accepts more so
 * a client that queued through a long offline stretch can drain in one request rather
 * than hammering the endpoint - which is the behaviour this whole change exists to
 * avoid. Past the cap the batch is rejected outright rather than truncated, because
 * silently dropping the tail would under-count without anyone noticing.
 */
export const MAX_BATCH_EVENTS = 50;
export const MAX_BATCH_BODY_BYTES = MAX_BODY_BYTES * MAX_BATCH_EVENTS;
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
// Interstitial A/B experiment (0.53.0). Every key below comes from a closed set in
// ads/interstitialConfigSchema.ts, re-validated by validateEventParams before this
// runs, so none of these maps can grow past its domain:
//   byArmOutcome    "treatment|shown" - arm x outcome, at most 2 x 5 = 10 keys. Crossed
//                   because "suppressed" occurs in both arms and must stay attributable.
//   byCadence       "7" - the gamesBetweenAds the opportunity ran under, at most 6 keys.
//   byInterstitialReason  the bounded failure reason, at most 5 keys.
// Deliberately NOT crossed with country, version or each other beyond arm|outcome.
const ARM_OUTCOME_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["interstitial_checkpoint", "interstitial_continuation"]);
const CADENCE_BREAKOUT_EVENTS = ARM_OUTCOME_BREAKOUT_EVENTS;
const INTERSTITIAL_REASON_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["interstitial_load_failed", "interstitial_checkpoint"]);
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
// Coarse country, derived SERVER-SIDE from the request (see COUNTRY_HEADER below) and
// never sent by the client. Only the two-letter code is kept: no IP, no city, no
// region, no coordinates, no ASN, and nothing else from the Cloudflare request
// metadata. The code is the country of the NETWORK REQUEST as Cloudflare sees it - a
// VPN reports its exit country, not where the person is.
//
// An explicit list, never "all events". Each entry below has to justify itself, in
// three groups: rewarded-ad diagnostics, multiplayer cost, and acquisition. The two
// rewarded ones are the signal; the two offer-shown ones are the DENOMINATOR, without
// which a country that simply has more players always looks like it fails more.
const COUNTRY_BREAKOUT_EVENTS = new Set<AnalyticsEventName>([
  "rewarded_ad_unavailable",
  "rewarded_ad_loaded",
  "reward_offer_shown",
  "reward_bonus_offer_shown",
  // Multiplayer cost measurement (multiplayerGuard.ts). RoomDO has no country
  // dimension of its own and cannot cheaply gain one, so the share of multiplayer
  // load per country was being INFERRED from the rewarded-ad events above - a proxy
  // that measures ad impressions, not rooms. These two make it a measurement:
  //
  //   mp_room_created  - emitted by the HOST only, right after POST /api/room
  //                      succeeds, so its byCountry is literally "where rooms are
  //                      created from". This is the number creation-side admission
  //                      control would act on.
  //   mp_game_started  - emitted by EVERY player in the room, so its byCountry is a
  //                      participant mix, NOT creator country. Useful for "where
  //                      multiplayer is played", and must not be read as the former.
  //
  // Free: the country is already resolved server-side for every event by
  // forwardToAnalyticsDO, and both events already exist. No new event, no extra DO
  // request, no KV write, no per-room state.
  "mp_room_created",
  "mp_game_started",
  // Acquisition measurement. Where new installs are coming from decides whether ad
  // monetization is realistically available for them at all, and nothing here could
  // answer that: byCountry existed only on ad and multiplayer events, which measure
  // people who already play, not people who just arrived.
  //
  //   first_open         - fires once per installation on first launch, so its
  //                        byCountry is the acquisition-side distribution.
  //   install_attributed - fires when an install referrer resolves, so its byCountry
  //                        is the same distribution restricted to attributable
  //                        installs, and is the denominator-free subset of the above.
  //
  // Read both as NETWORK country at the moment the request carrying the event arrived
  // - not physical location, not Play account or store country, not nationality, and
  // not necessarily the country at install time. A VPN or proxy changes it. And with
  // A4 client batching (services/analyticsQueue.ts) an event can be queued and sent
  // later, so the country is whatever Cloudflare saw on the BATCH request that carried
  // it, which need not be the network the event was generated on.
  //
  // Forward-only: events already counted have no country and cannot gain one.
  "first_open",
  "install_attributed",
  // Interstitial opportunities per NETWORK country - the check that server-side
  // country gating behaves (an ineligible country should produce none at all).
  "interstitial_checkpoint",
]);
// Country alone says WHERE, reason alone says WHAT - only the pair says whether Iran
// specifically times out while Germany errors. Both halves are closed sets, so the
// combined key cannot be arbitrary.
const COUNTRY_REASON_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["rewarded_ad_unavailable"]);
// Country and app version crossed, because the two existing dimensions are separate
// maps and therefore cannot answer the question that decides whether an Android
// release is needed: are the Iranian failures coming from 0.48.4, from 0.50.0, or
// from both equally? byCountry says where, byAppVersion says which build, neither
// says both. The four rewarded events only - the two rewarded ones plus the two
// offer-shown denominators, because a version with more players in a country will
// always produce more failures there.
// Deliberately its OWN set rather than an alias of the one above. It used to be an
// alias, which meant adding any event to byCountry silently gave it the crossed
// country x version map too. The two multiplayer events want byCountry only; the
// crossed map exists to answer an Android-release question about rewarded ads and
// has no bearing on room creation or on where installs come from. The acquisition
// pair wants byCountry only for the same reason: crossing it with app version would
// multiply keys to answer a question nobody asked.
const COUNTRY_VERSION_BREAKOUT_EVENTS = new Set<AnalyticsEventName>([
  "rewarded_ad_unavailable",
  "rewarded_ad_loaded",
  "reward_offer_shown",
  "reward_bonus_offer_shown",
]);
const COUNTRY_VERSION_REASON_BREAKOUT_EVENTS = COUNTRY_REASON_BREAKOUT_EVENTS;
// Country crossed with game type, on game_started ONLY.
//
// The question it exists to answer: Shape Challenge ("Classic") is ~97% of all game
// starts, acquisition is heavily IR-weighted, and rewarded delivery in IR is
// effectively non-functional - so how much of the gameplay we would monetize is in a
// market where AdMob monetization is not realistically available? byGameType says
// WHAT is played and the country maps say WHERE people are, but neither crosses, and
// game_started had no country dimension at all.
//
// Deliberately NOT added to COUNTRY_BREAKOUT_EVENTS: the crossed map already answers
// "how many starts from IR" by summing that country's game types, so a separate
// byCountry on the same event would be a second map carrying no extra information.
//
// game_started only, not the whole of FUNNEL_EVENTS. game_completed and result_shared
// would answer a different question (completion/share rate by country), nobody has
// asked it, and each extra event multiplies stored keys by the live country count.
//
// Both halves are closed domains - GAME_TYPE_PARAMS and the ISO code set plus
// UNKNOWN_COUNTRY - so unlike byCountryAppVersion the cap below is a safety net
// rather than the real bound.
const COUNTRY_GAME_TYPE_BREAKOUT_EVENTS = new Set<AnalyticsEventName>(["game_started"]);
// ~6 game types x the countries CYDI actually sees. The theoretical ceiling is the
// full ISO set x game types, hence a cap; the practical size is a few dozen keys.
// Overflow shares the dedicated OTHER key, which is never ZZ - ZZ means the country
// was unknown, OTHER means the map filled up.
const MAX_COUNTRY_GAME_TYPE_KEYS = 200;
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
/**
 * The internal header index.ts puts the ENFORCED analytics keep rate in, 0-100.
 *
 * Absent means nothing sampled this request - either the shed policy was NORMAL or it
 * was monitorOnly, both of which forward the original body untouched - so an absent
 * header normalizes to 100, not to 0. Like COUNTRY_HEADER this is not a client
 * contract: index.ts overwrites it on every request and the DO re-normalizes whatever
 * arrives, so a client cannot claim its events were sampled and inflate itself 10x in
 * a report.
 */
export const SHED_KEEP_HEADER = "x-cydi-shed-keep";
/** No sampling: every event that was sent reached the DO. */
export const FULL_KEEP_PERCENT = 100;
/** Country could not be determined: absent, Cloudflare's XX/T1, or malformed. */
export const UNKNOWN_COUNTRY = "ZZ";
/** Cardinality overflow for byCountryReason - deliberately NOT UNKNOWN_COUNTRY, so "we do not know the country" and "too many distinct keys" stay separate facts. */
const COUNTRY_REASON_OVERFLOW = "OTHER";
// 249 assigned ISO codes x 9 AD_FAILURE_REASONS is 2,241 worst case, which is a real
// fraction of a Durable Object value. Real traffic uses a few dozen, so the cap only
// ever bites under a forged flood.
const MAX_COUNTRY_REASON_KEYS = 150;
// Country x keepPercent. Unlike the crossed maps above BOTH sides are closed domains
// (normalizeCountry, and 0-100 integers from normalizeKeepPercent), so the theoretical
// ceiling is bounded at 249 x 101 rather than unbounded - but a policy realistically
// uses one or two distinct rates, making the live size a few dozen keys. Capped anyway,
// because "bounded at 25,149" is not the same as "small".
const MAX_COUNTRY_KEEP_PERCENT_KEYS = 200;

/**
 * Whole-percent keep rate in [0,100]; anything else becomes FULL_KEEP_PERCENT.
 *
 * Falling back to 100 rather than 0 is the safe direction on purpose: a report that
 * believes nothing was sampled understates, while one that believes a 100% day was a
 * 10% sample would multiply real counters by ten and invent traffic that never
 * happened. Understating is recoverable; fabricating is not.
 *
 * 0 is a legitimate value (a country shedding everything but the preserved set) and
 * must survive, which is why this cannot be written as `|| FULL_KEEP_PERCENT`.
 */
export function normalizeKeepPercent(value: unknown): number {
  // Digits only, deliberately: Number("") is 0, so a header that is present but empty
  // would otherwise read as "this country shed everything" and a complete day would be
  // scaled up from nothing. The same strictness rejects "1e1", "0x10" and " -0",
  // none of which this code ever writes and all of which Number() would accept.
  let raw: number;
  if (typeof value === "number") raw = value;
  else if (typeof value === "string" && /^\s*\d{1,3}\s*$/.test(value)) raw = Number(value.trim());
  else return FULL_KEEP_PERCENT;
  if (!Number.isInteger(raw) || raw < 0 || raw > 100) return FULL_KEEP_PERCENT;
  return raw;
}

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
  // ARM_OUTCOME / CADENCE / INTERSTITIAL_REASON breakout events only - see those sets.
  // Absent on every other event, and on day buckets recorded before 0.53.0.
  byArmOutcome?: Record<string, number>;
  byCadence?: Record<string, number>;
  byInterstitialReason?: Record<string, number>;
  // app_open ONLY, like byAppBuild - the native Android versionCode, which tells two
  // APKs of one versionName apart. Web never sends one; a native client that has not
  // read it yet, and every client older than 0.53.0, counts as "unknown".
  byAppVersionCode?: Record<string, number>;
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
  // COUNTRY_GAME_TYPE_BREAKOUT_EVENTS (game_started) only - the same country crossed
  // with the event's own gameType: "IR|shapeChallenge", "DE|dailyChallenge". Both
  // halves are closed sets, so the key cannot be arbitrary; capped anyway at
  // MAX_COUNTRY_GAME_TYPE_KEYS with the shared OTHER overflow. Absent on every other
  // event, and on day buckets recorded before this field existed - such a day reports
  // no country x game-type rows at all rather than guessing them.
  byCountryGameType?: Record<string, number>;
  /** ANALYTICS_REQUESTS_KEY only - "<country>|<keepPercent>". See incrementRequestCountry. */
  byCountryKeepPercent?: Record<string, number>;
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

/**
 * Reserved counter key for AnalyticsDO REQUESTS (not events), deliberately NOT an
 * AnalyticsEventName.
 *
 * That is the security property: `isAnalyticsEventName` rejects it, so no client can
 * POST `eventName: "analytics_requests"` and forge quota attribution. It only ever
 * gets written by the ingest path below, from the country the Worker resolved.
 */
export const ANALYTICS_REQUESTS_KEY = "analytics_requests";

// The request counter rides inside the SAME stored object as the event counters, so it
// costs no extra storage key, no extra read and no extra write - see recordRequest().
type AllCounters = Partial<Record<AnalyticsEventName, EventCounters>> & {
  [ANALYTICS_REQUESTS_KEY]?: EventCounters;
};

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
  appVersionCode: string = "unknown",
): AllCounters {
  // Resolved HERE rather than at the call site, so the canonical name is the only one
  // that can ever be written - no future caller can reintroduce the legacy key. Every
  // breakout below keys off the stored name, which is what a report reads back.
  eventName = canonicalEventName(eventName);
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
    // Re-normalized here for the same reason normalizeCountry is below: this function
    // is exported, and a direct caller must not open a key ingest could never produce.
    // Android only: the website has no versionCode, and a web row would only ever read "unknown".
    if (platform === "android") {
      updated.byAppVersionCode = incrementKeyMap(existing.byAppVersionCode, normalizeAppVersionCode(appVersionCode));
    }
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
  // Interstitial experiment - guarded like the others, so a direct call with a bad
  // value leaves the map untouched rather than opening a free-text key.
  if (ARM_OUTCOME_BREAKOUT_EVENTS.has(eventName) && isInterstitialArm(params.arm) && isInterstitialOutcome(params.outcome)) {
    updated.byArmOutcome = incrementKeyMap(existing.byArmOutcome, `${params.arm}|${params.outcome}`);
  }
  if (CADENCE_BREAKOUT_EVENTS.has(eventName) && isInterstitialCadence(params.gamesBetweenAds)) {
    updated.byCadence = incrementKeyMap(existing.byCadence, String(params.gamesBetweenAds));
  }
  if (INTERSTITIAL_REASON_BREAKOUT_EVENTS.has(eventName) && isInterstitialFailureReason(params.reason)) {
    updated.byInterstitialReason = incrementKeyMap(existing.byInterstitialReason, params.reason);
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
  // Country x game type. Guarded on isGameType so a direct call (tests, a future
  // caller) cannot open a key for a gameType validateEventParams would have rejected -
  // the same discipline isAdFailureReason enforces on the reason crosses above.
  if (COUNTRY_GAME_TYPE_BREAKOUT_EVENTS.has(eventName) && isGameType(params.gameType)) {
    updated.byCountryGameType = incrementCappedKeyMap(
      existing.byCountryGameType,
      `${normalizeCountry(country)}|${params.gameType}`,
      MAX_COUNTRY_GAME_TYPE_KEYS,
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

/**
 * Wire names that are stored under a DIFFERENT, canonical name.
 *
 * `purchase_completed` was always a coin-funded Shop unlock, never a real-money
 * purchase (CYDI has no IAP at all), and the name misled every report it appeared
 * in. Rather than add a second event - which would cost extra storage keys and risk
 * double counting - the legacy name is resolved to the canonical one at INGESTION,
 * so one player action increments exactly one counter no matter which name the
 * client sent. The legacy name stays a valid input forever; clients that predate
 * the rename need no update.
 */
const CANONICAL_EVENT_ALIASES: Partial<Record<AnalyticsEventName, AnalyticsEventName>> = {
  purchase_completed: "shop_purchase_with_coins",
};

/** The name an event is STORED under. Identity for everything without an alias. */
export function canonicalEventName(eventName: AnalyticsEventName): AnalyticsEventName {
  return CANONICAL_EVENT_ALIASES[eventName] ?? eventName;
}

/**
 * Read-time half of the alias: folds any legacy key still present in a bucket into
 * its canonical name, so a report shows ONE continuous series.
 *
 * Both keys legitimately coexist in the bucket for the day the alias deployed -
 * events counted before the deploy landed under the legacy name, events after it
 * under the canonical one - and in every historical bucket written before it. That
 * is a sum, not a double count: each event only ever incremented one of them.
 * Historical buckets are never rewritten; the fold happens on the way out.
 */
export function foldCanonicalAliases(counts: AllCounters): AllCounters {
  let result: AllCounters | null = null;
  for (const [legacy, canonical] of Object.entries(CANONICAL_EVENT_ALIASES) as [AnalyticsEventName, AnalyticsEventName][]) {
    const legacyCounters = counts[legacy];
    if (legacyCounters === undefined) continue;
    result ??= { ...counts };
    // mergeCounters skips an undefined side, so this is also correct for a range
    // that contains only legacy days or only canonical ones.
    result[canonical] = mergeCounters({ [canonical]: legacyCounters }, { [canonical]: result[canonical] })[canonical];
    delete result[legacy];
  }
  return result ?? counts;
}

/**
 * Adds one AnalyticsDO REQUEST, from the network country the Worker resolved.
 *
 * Counts requests, never events: A4 batches up to MAX_BATCH_EVENTS into a single DO
 * invocation, and it is the invocation that consumes quota, so a batch of ten counts
 * exactly once. Only byCountry is kept - no version, event, game-type or platform
 * cross; those questions already have their own metrics.
 *
 * Country is a closed domain after normalizeCountry (two uppercase letters, or ZZ),
 * so the map needs no cap - the same reasoning byCountry already relies on.
 */
export function incrementRequestCountry(
  counters: AllCounters,
  country: string,
  keepPercent: number = FULL_KEEP_PERCENT,
): AllCounters {
  const existing = counters[ANALYTICS_REQUESTS_KEY] ?? { total: 0 };
  const code = normalizeCountry(country);
  return {
    ...counters,
    [ANALYTICS_REQUESTS_KEY]: {
      ...existing,
      total: existing.total + 1,
      byCountry: incrementKeyMap(existing.byCountry, code),
      // The scaling key. Every OTHER counter in a sampled day is a sample of unknown
      // rate on its own; this is the only record of what that rate was, and it is
      // crossed with country because the rate is per-country policy - a uniform
      // multiplier would be wrong the moment IR and DE run different keepPercents.
      //
      // It counts REQUESTS at that rate, not events, for the same reason the parent
      // counter does: the request is the quota unit, and it is also the unit sampling
      // acted on. Reading it: a day whose map is {"IR|10": 900, "DE|25": 300} means
      // IR-attributed counters are a 10% sample and DE-attributed ones a 25% sample.
      // A day with a single "XX|100" key was not sampled at all.
      byCountryKeepPercent: incrementCappedKeyMap(
        existing.byCountryKeepPercent,
        `${code}|${normalizeKeepPercent(keepPercent)}`,
        MAX_COUNTRY_KEEP_PERCENT_KEYS,
        COUNTRY_REASON_OVERFLOW,
      ),
    },
  };
}

export function mergeCounters(a: AllCounters, b: AllCounters): AllCounters {
  const merged: AllCounters = { ...a };
  // Merged explicitly: the loop below walks ANALYTICS_EVENT_NAMES, and the request
  // counter is deliberately not one of them, so it would otherwise be dropped from
  // every multi-day range report.
  if (b[ANALYTICS_REQUESTS_KEY]) {
    const ar = merged[ANALYTICS_REQUESTS_KEY] ?? { total: 0 };
    const br = b[ANALYTICS_REQUESTS_KEY];
    merged[ANALYTICS_REQUESTS_KEY] = {
      ...ar,
      total: ar.total + br.total,
      byCountry: mergeKeyMaps(ar.byCountry, br.byCountry),
      // Summing across days is what makes a multi-day range interpretable at all: a
      // range spanning a 100% day and a 10% day produces {"IR|100": n, "IR|10": m}
      // rather than one blended rate that describes neither day.
      byCountryKeepPercent: mergeKeyMaps(ar.byCountryKeepPercent, br.byCountryKeepPercent),
    };
  }
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
      byArmOutcome: mergeKeyMaps(ae.byArmOutcome, be.byArmOutcome),
      byCadence: mergeKeyMaps(ae.byCadence, be.byCadence),
      byInterstitialReason: mergeKeyMaps(ae.byInterstitialReason, be.byInterstitialReason),
      byAppVersionCode: mergeKeyMaps(ae.byAppVersionCode, be.byAppVersionCode),
      byRoundCount: mergeKeyMaps(ae.byRoundCount, be.byRoundCount),
      byRoundIndex: mergeKeyMaps(ae.byRoundIndex, be.byRoundIndex),
      byCountry: mergeKeyMaps(ae.byCountry, be.byCountry),
      byCountryReason: mergeKeyMaps(ae.byCountryReason, be.byCountryReason),
      byCountryAppVersion: mergeKeyMaps(ae.byCountryAppVersion, be.byCountryAppVersion),
      byCountryAppVersionReason: mergeKeyMaps(ae.byCountryAppVersionReason, be.byCountryAppVersionReason),
      byCountryGameType: mergeKeyMaps(ae.byCountryGameType, be.byCountryGameType),
      // Only ANALYTICS_REQUESTS_KEY ever carries this, and that key is merged in its
      // own branch above because it is not an AnalyticsEventName. Merged here too for
      // the same reason every other selective map is - mergeKeyMaps(undefined,
      // undefined) stays undefined, so no event gains a phantom key, and nothing is
      // silently dropped if the field ever spreads.
      byCountryKeepPercent: mergeKeyMaps(ae.byCountryKeepPercent, be.byCountryKeepPercent),
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
  /**
   * Count ONE envelope. The single-event endpoint and every entry of a batch go
   * through here, so the two paths cannot drift: same validation, same closed-set
   * coercion, same incrementEvent call, same buffer. A batch is a transport
   * optimisation, never a second way of counting.
   *
   * Returns false for an envelope that fails validation. The caller decides what
   * that means - 400 for a single event, a skipped entry for a batch - because a
   * batch must not lose nine good events to one bad one.
   */
  private async ingestOne(
    body: unknown,
    country: string,
    countRequest = false,
    keepPercent: number = FULL_KEEP_PERCENT,
  ): Promise<boolean> {
    const b = body as Record<string, unknown> | null;
    const eventName = b?.eventName;
    if (!isAnalyticsEventName(eventName)) return false;

    const validated = validateEventParams(eventName, b?.params);
    if (!validated.valid) return false;
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
    // Same contract again: optional (Android 0.53.0+ only), format-guarded, never a
    // reason to drop an event. Stored on app_open alone.
    const appVersionCode = normalizeAppVersionCode(b?.appVersionCode);
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
    // incrementEvent resolves the stored name itself (see CANONICAL_EVENT_ALIASES), so
    // the wire name is passed straight through: params were validated against the name
    // the client actually sent, and an aliased pair shares one validator.
    let nextAlltime = incrementEvent(alltime, eventName, params, platform, appVersion, appBuild, attribution, country, appVersionCode);
    let nextDay = incrementEvent(dayCounters, eventName, params, platform, appVersion, appBuild, attribution, country, appVersionCode);
    // Once per DO REQUEST, not per event - the caller passes countRequest for the first
    // entry it manages to ingest, so a ten-event batch still counts one. Folded into the
    // two counter objects that this ingest is already about to mark dirty, so it adds no
    // storage key, no read and no write, and it deliberately leaves pendingEvents alone
    // so flush frequency is exactly what it was.
    if (countRequest) {
      nextAlltime = incrementRequestCountry(nextAlltime, country, keepPercent);
      nextDay = incrementRequestCountry(nextDay, country, keepPercent);
    }
    this.counterCache.set(alltimeKey, nextAlltime);
    this.counterCache.set(dayKey, nextDay);
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

    this.pendingEvents++;
    return true;
  }

  /**
   * Persist if either budget is due.
   *
   * Durability happens HERE, inside the request, where the runtime's output gating
   * guarantees the write lands before the response does. A batch calls this ONCE
   * after counting every entry, so ten events cost at most one write rather than ten.
   *
   * What this deliberately does not protect: the events buffered since the last
   * boundary, if the stream then stops and the instance is evicted before another
   * event arrives. That tail is at most MAX_PENDING_EVENTS, and it costs something
   * only when the WHOLE app goes quiet - this is one global object aggregating every
   * player, so its stream is near-continuous during active hours. Paying for an alarm
   * to chase that tail costs more DO requests than the tail is worth, and DO requests
   * are the tighter of the two limits.
   */
  private async flushIfDue(): Promise<void> {
    if (this.flushDue(Date.now())) await this.flush();
  }

  /** Single-event ingest, unchanged on the wire. Old clients keep using this forever. */
  private async handleEvent(body: unknown, country: string, keepPercent: number): Promise<Response> {
    const b = body as Record<string, unknown> | null;
    // Split so the two failure modes stay distinguishable for a single event, which
    // is the contract old clients already rely on.
    if (!isAnalyticsEventName(b?.eventName)) return json({ error: "invalid event" }, 400);
    if (!(await this.ingestOne(body, country, true, keepPercent))) return json({ error: "invalid params" }, 400);
    await this.flushIfDue();
    return json({ ok: true });
  }

  /**
   * Batch ingest (A4). One DO request, one flush decision, N counted events.
   *
   * Partial acceptance is deliberate: a malformed entry is skipped and reported in
   * the response rather than failing the batch, so one bad event on a client can
   * never cost the other nine. The whole-body shape is still all-or-nothing - a body
   * that is not { events: [...] } is a client bug, not a data point.
   */
  private async handleEvents(body: unknown, country: string, keepPercent: number): Promise<Response> {
    const b = body as Record<string, unknown> | null;
    const events = b?.events;
    if (!Array.isArray(events)) return json({ error: "body must be { events: [...] }" }, 400);
    if (events.length === 0) return json({ error: "empty batch" }, 400);
    if (events.length > MAX_BATCH_EVENTS) return json({ error: "batch too large" }, 400);

    let accepted = 0;
    // The whole batch is ONE DO request, so the request counter is offered to each
    // entry until one is actually ingested, and then never again for this batch.
    let requestCounted = false;
    for (const event of events) {
      if (await this.ingestOne(event, country, !requestCounted, keepPercent)) {
        accepted++;
        requestCounted = true;
      }
    }
    await this.flushIfDue();
    return json({ ok: true, accepted, rejected: events.length - accepted });
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
    rawCounts: AllCounters,
    usage: { selected: UsageSummary; external: UsageSummary; internal: UsageSummary } | null,
  ) {
    // Single choke point for every period (daily/weekly/monthly/range/alltime), so no
    // report can ever show the legacy and canonical names as two separate rows.
    const counts = foldCanonicalAliases(rawCounts);
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

    if ((url.pathname === "/event" || url.pathname === "/events") && request.method === "POST") {
      const batch = url.pathname === "/events";
      const bodyText = await request.text();
      const limit = batch ? MAX_BATCH_BODY_BYTES : MAX_BODY_BYTES;
      if (!bodyText || bodyText.length > limit) return json({ error: "invalid payload" }, 400);
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      // Country is resolved once per REQUEST, not per event - every envelope in a
      // batch came from the same client on the same connection, so they share it.
      const country = normalizeCountry(request.headers.get(COUNTRY_HEADER));
      // Same reasoning as country: the shed decision was taken once, for the whole
      // request, so every envelope inside it was sampled at the same rate.
      const keepPercent = normalizeKeepPercent(request.headers.get(SHED_KEEP_HEADER));
      return batch ? this.handleEvents(body, country, keepPercent) : this.handleEvent(body, country, keepPercent);
    }

    if (url.pathname === "/report" && request.method === "GET") {
      return this.handleReport(url, request.headers.get("authorization"));
    }

    return json({ error: "not found" }, 404);
  }
}
