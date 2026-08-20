/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Single source of truth for every analytics event's exact param shape, shared by both
// the client (src/services/analytics.ts) and the Worker (worker/analyticsDO.ts imports
// straight from here, same as worker/dailyChallengeDO.ts already imports SHAPE_LIBRARY
// from ../src/engine/shapeLibrary.ts). Each event has its OWN schema - there is no
// generic catch-all shape, so an event never accepts a param it doesn't actually use.
//
// Field naming note: content-identifying fields are named contentKey/artistKey/packKey
// rather than *Id, specifically so they never collide with the PII-style identifier
// filtering in analytics.ts's sanitizeParams denylist (now or if that denylist is later
// hardened to a suffix/substring check). These are still just opaque content ids, never
// player/device ids.
// DELIBERATE ENGINE IMPORT (not the ContentRepository): this module is shared
// with the Cloudflare Worker, and src/content/contentRepository.ts pulls in
// artistPackLibrary, whose helpers read `import.meta.env` - which doesn't exist
// in the workerd runtime. Client code everywhere else must go through the
// repository; this file is the documented exception.
import { CATEGORIES, type CategoryId } from "../engine/shapeLibrary";
import { isRewardedAdPlacement, type RewardedAdPlacement } from "./ads/adPlacements";
import { isAdFailureReason, type AdFailureReason } from "./ads/adTypes";

export type GameType =
  | "shapeChallenge"
  | "dailyChallenge"
  | "megaChallenge"
  | "artistPack"
  | "specialChallenge"
  | "customChallenge"
  /**
   * A web SEO landing page's practice round (src/seo/landingPages.ts): the Shape
   * Challenge experience, played and scored for real, but persisting nothing - no
   * progression, coins or counters (see app/shapeRoundOutcome.ts).
   *
   * Its own game type rather than a `practice` param on top of "shapeChallenge",
   * because the Worker stores a `byGameType` breakdown for the funnel events and
   * would validate-then-DROP any new param (same reasoning as the mirrored
   * reward_bonus_* names below). This keeps SEO-practice usage measurable while
   * leaving the shapeChallenge funnel a clean real-play baseline. Web-only: the
   * Android app has no landing pages and can never emit it.
   */
  | "seoPractice";

export type CategoryOrCustom = CategoryId | "custom";

export type EventParamsMap = {
  app_open: Record<string, never>;
  shape_completed: { category: CategoryId; starRating: number; passed: boolean; isNewBest: boolean };
  /**
   * The same round result, for an SEO practice round only (gameType "seoPractice"
   * above). A mirrored NAME rather than a param for the same reason the
   * reward_bonus_* events use one: shape_completed is not a funnel event, so the
   * Worker keeps only total/byPlatform plus the score aggregates for it and drops
   * every param on ingest - a `practice` flag could never be reported on.
   *
   * Splitting the name also keeps averageScore/passRate (both derived from
   * shape_completed alone) as a real-play baseline that landing-page practice
   * attempts cannot skew, while still counting those attempts here.
   */
  shape_practice_completed: { category: CategoryId; starRating: number; passed: boolean; isNewBest: boolean };
  purchase_completed: { productType: "penColor" | "penSkin" | "chestKey" | "megaCard"; tier: string; price: number };
  mega_card_unlocked: { rarity: "rare" | "epic" | "legendary" };
  artist_pack_link_clicked: { artistKey: string; packKey: string; hasAffiliate: boolean };
  game_started: { gameType: GameType; category: CategoryOrCustom; contentKey: string };
  game_completed: { gameType: GameType; category: CategoryOrCustom; contentKey: string };
  result_shared: { gameType: GameType; category: CategoryOrCustom; contentKey: string };
  // Daily challenge episode referenced a shape this client couldn't resolve
  // (old cached catalog / offline) and a safe local substitute was played
  // instead. Opaque content ids only - never player/device data.
  daily_shape_fallback: { contentKey: string; substituteKey: string; hadCache: boolean };
  // Rewarded ad lifecycle (emitted only by src/services/ads/adAnalytics.ts).
  // `placement` and `reason` are closed unions owned by the ads module - never
  // free text, so no SDK error detail or sensitive info can reach analytics.
  rewarded_ad_requested: { placement: RewardedAdPlacement };
  rewarded_ad_loaded: { placement: RewardedAdPlacement };
  rewarded_ad_shown: { placement: RewardedAdPlacement };
  rewarded_ad_completed: { placement: RewardedAdPlacement };
  rewarded_ad_dismissed: { placement: RewardedAdPlacement };
  rewarded_ad_unavailable: { placement: RewardedAdPlacement; reason: AdFailureReason };
  rewarded_ad_failed: { placement: RewardedAdPlacement; reason: AdFailureReason };
  // Reward-offer UX funnel (emitted only by src/components/DoubleCoinsOffer.tsx).
  // A DIFFERENT, coarser layer than the rewarded_ad_* SDK-lifecycle events above:
  // these track what the PLAYER did/saw in the offer banner, not what the SDK did.
  // Funnel: offer_shown -> (skipped | ad_started -> (ad_completed | ad_failed)).
  // fallback_used is retained for historical data only: the math-quiz path it tracked
  // is now dev-only, so user-facing builds never emit it. `placement` only - no PII,
  // no new identifiers.
  reward_offer_shown: { placement: RewardedAdPlacement };
  reward_ad_started: { placement: RewardedAdPlacement };
  reward_ad_completed: { placement: RewardedAdPlacement };
  reward_ad_failed: { placement: RewardedAdPlacement };
  reward_skipped: { placement: RewardedAdPlacement };
  reward_fallback_used: { placement: RewardedAdPlacement };
  // The SAME offer funnel, for the periodic 3× bonus round only (app/bonusRewardRound.ts).
  // Mirrored EVENT NAMES rather than a `multiplier`/`rewardType` param, because the
  // Worker aggregates by event name and keeps only total + byPlatform for these events -
  // params never reach storage (even `placement` is validated and then dropped), so a
  // new field would be silently discarded and could never be reported on. A ×3 round
  // emits only these, never the plain ones, so the two sets stay disjoint and the
  // existing reward_* counts remain a clean ×2-only baseline.
  reward_bonus_offer_shown: { placement: RewardedAdPlacement };
  reward_bonus_ad_started: { placement: RewardedAdPlacement };
  reward_bonus_ad_completed: { placement: RewardedAdPlacement };
  reward_bonus_ad_failed: { placement: RewardedAdPlacement };
  reward_bonus_skipped: { placement: RewardedAdPlacement };
  /** The one-per-session nudge after 3 consecutive skips actually rendered. */
  reward_reminder_shown: { placement: RewardedAdPlacement };
  /** The one-time "watch a short ad to double" explainer actually rendered - fires at
   * most once per player, on whichever reward offer they met first. */
  reward_double_tutorial_shown: { placement: RewardedAdPlacement };
  /** The one-time result-screen callout pointing at the continue action rendered. */
  result_actions_tutorial_shown: { placement: RewardedAdPlacement };
  /** Create Challenge feature discovery. No params: the prompt has no placement of
   * its own and we deliberately add no attribution plumbing for it. */
  create_discovery_shown: Record<string, never>;
  create_discovery_accepted: Record<string, never>;
  /** A challenge was created and saved - from the discovery prompt or anywhere else,
   * so this doubles as the overall "challenges created" measure. */
  challenge_created: Record<string, never>;
};

export type AnalyticsEventName = keyof EventParamsMap;

export const ANALYTICS_EVENT_NAMES: AnalyticsEventName[] = [
  "app_open",
  "shape_completed",
  "shape_practice_completed",
  "purchase_completed",
  "mega_card_unlocked",
  "artist_pack_link_clicked",
  "game_started",
  "game_completed",
  "result_shared",
  "daily_shape_fallback",
  "rewarded_ad_requested",
  "rewarded_ad_loaded",
  "rewarded_ad_shown",
  "rewarded_ad_completed",
  "rewarded_ad_dismissed",
  "rewarded_ad_unavailable",
  "rewarded_ad_failed",
  "reward_offer_shown",
  "reward_ad_started",
  "reward_ad_completed",
  "reward_ad_failed",
  "reward_skipped",
  "reward_fallback_used",
  "reward_bonus_offer_shown",
  "reward_bonus_ad_started",
  "reward_bonus_ad_completed",
  "reward_bonus_ad_failed",
  "reward_bonus_skipped",
  "reward_reminder_shown",
  "reward_double_tutorial_shown",
  "result_actions_tutorial_shown",
  "create_discovery_shown",
  "create_discovery_accepted",
  "challenge_created",
];

export type ValidationResult<E extends AnalyticsEventName> =
  | { valid: true; params: EventParamsMap[E] }
  | { valid: false };

const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);
const GAME_TYPES: GameType[] = [
  "shapeChallenge",
  "dailyChallenge",
  "megaChallenge",
  "artistPack",
  "specialChallenge",
  "customChallenge",
  "seoPractice",
];
const PRODUCT_TYPES = ["penColor", "penSkin", "chestKey", "megaCard"] as const;
const MEGA_RARITIES = ["rare", "epic", "legendary"] as const;

const MAX_STRING_LENGTH = 64;
const MAX_PRICE = 100_000;
// Opaque content identifiers only - letters, digits, dash, underscore, colon (e.g. "daily:42").
const SAFE_STRING_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only if `obj`'s keys are exactly `keys` (no extras, none missing) - the "no partial/loose match" guarantee. */
function hasExactKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  const objKeys = Object.keys(obj);
  if (objKeys.length !== keys.length) return false;
  return keys.every((k) => objKeys.includes(k));
}

function isSafeString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_STRING_LENGTH && SAFE_STRING_PATTERN.test(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE;
}

function isCategoryOrCustom(value: unknown): value is CategoryOrCustom {
  return value === "custom" || (typeof value === "string" && (CATEGORY_IDS as string[]).includes(value));
}

function isGameType(value: unknown): value is GameType {
  return typeof value === "string" && (GAME_TYPES as string[]).includes(value);
}

type Validator<E extends AnalyticsEventName> = (params: unknown) => ValidationResult<E>;

const VALIDATORS: { [E in AnalyticsEventName]: Validator<E> } = {
  app_open: (p) => {
    if (!isRecord(p) || Object.keys(p).length !== 0) return { valid: false };
    return { valid: true, params: {} };
  },
  shape_completed: (p) => validateRoundResultEvent(p),
  shape_practice_completed: (p) => validateRoundResultEvent(p),
  purchase_completed: (p) => {
    if (!isRecord(p) || !hasExactKeys(p, ["productType", "tier", "price"])) return { valid: false };
    const { productType, tier, price } = p;
    if (typeof productType !== "string" || !(PRODUCT_TYPES as readonly string[]).includes(productType)) return { valid: false };
    if (!isSafeString(tier)) return { valid: false };
    if (!isFinitePrice(price)) return { valid: false };
    return { valid: true, params: { productType: productType as EventParamsMap["purchase_completed"]["productType"], tier, price } };
  },
  mega_card_unlocked: (p) => {
    if (!isRecord(p) || !hasExactKeys(p, ["rarity"])) return { valid: false };
    const { rarity } = p;
    if (typeof rarity !== "string" || !(MEGA_RARITIES as readonly string[]).includes(rarity)) return { valid: false };
    return { valid: true, params: { rarity: rarity as EventParamsMap["mega_card_unlocked"]["rarity"] } };
  },
  artist_pack_link_clicked: (p) => {
    if (!isRecord(p) || !hasExactKeys(p, ["artistKey", "packKey", "hasAffiliate"])) return { valid: false };
    const { artistKey, packKey, hasAffiliate } = p;
    if (!isSafeString(artistKey) || !isSafeString(packKey)) return { valid: false };
    if (!isBoolean(hasAffiliate)) return { valid: false };
    return { valid: true, params: { artistKey, packKey, hasAffiliate } };
  },
  game_started: (p) => validateFunnelEvent(p),
  game_completed: (p) => validateFunnelEvent(p),
  result_shared: (p) => validateFunnelEvent(p),
  daily_shape_fallback: (p) => {
    if (!isRecord(p) || !hasExactKeys(p, ["contentKey", "substituteKey", "hadCache"])) return { valid: false };
    const { contentKey, substituteKey, hadCache } = p;
    if (!isSafeString(contentKey) || !isSafeString(substituteKey) || !isBoolean(hadCache)) return { valid: false };
    return { valid: true, params: { contentKey, substituteKey, hadCache } };
  },
  rewarded_ad_requested: (p) => validateAdEvent(p),
  rewarded_ad_loaded: (p) => validateAdEvent(p),
  rewarded_ad_shown: (p) => validateAdEvent(p),
  rewarded_ad_completed: (p) => validateAdEvent(p),
  rewarded_ad_dismissed: (p) => validateAdEvent(p),
  rewarded_ad_unavailable: (p) => validateAdFailureEvent(p),
  rewarded_ad_failed: (p) => validateAdFailureEvent(p),
  reward_offer_shown: (p) => validateAdEvent(p),
  reward_ad_started: (p) => validateAdEvent(p),
  reward_ad_completed: (p) => validateAdEvent(p),
  reward_ad_failed: (p) => validateAdEvent(p),
  reward_skipped: (p) => validateAdEvent(p),
  reward_fallback_used: (p) => validateAdEvent(p),
  reward_bonus_offer_shown: (p) => validateAdEvent(p),
  reward_bonus_ad_started: (p) => validateAdEvent(p),
  reward_bonus_ad_completed: (p) => validateAdEvent(p),
  reward_bonus_ad_failed: (p) => validateAdEvent(p),
  reward_bonus_skipped: (p) => validateAdEvent(p),
  reward_reminder_shown: (p) => validateAdEvent(p),
  reward_double_tutorial_shown: (p) => validateAdEvent(p),
  result_actions_tutorial_shown: (p) => validateAdEvent(p),
  create_discovery_shown: (p) => validateNoParams(p),
  create_discovery_accepted: (p) => validateNoParams(p),
  challenge_created: (p) => validateNoParams(p),
};

/** Events that carry no params at all - same rule app_open uses. */
function validateNoParams<E extends "create_discovery_shown" | "create_discovery_accepted" | "challenge_created">(
  p: unknown,
): ValidationResult<E> {
  if (!isRecord(p) || Object.keys(p).length !== 0) return { valid: false };
  return { valid: true, params: {} as EventParamsMap[E] };
}

function validateAdEvent<
  E extends
    | "rewarded_ad_requested"
    | "rewarded_ad_loaded"
    | "rewarded_ad_shown"
    | "rewarded_ad_completed"
    | "rewarded_ad_dismissed"
    | "reward_offer_shown"
    | "reward_ad_started"
    | "reward_ad_completed"
    | "reward_ad_failed"
    | "reward_skipped"
    | "reward_fallback_used"
    | "reward_bonus_offer_shown"
    | "reward_bonus_ad_started"
    | "reward_bonus_ad_completed"
    | "reward_bonus_ad_failed"
    | "reward_bonus_skipped"
    | "reward_reminder_shown"
    | "reward_double_tutorial_shown"
    | "result_actions_tutorial_shown",
>(p: unknown): ValidationResult<E> {
  if (!isRecord(p) || !hasExactKeys(p, ["placement"])) return { valid: false };
  if (!isRewardedAdPlacement(p.placement)) return { valid: false };
  return { valid: true, params: { placement: p.placement } as EventParamsMap[E] };
}

function validateAdFailureEvent<E extends "rewarded_ad_unavailable" | "rewarded_ad_failed">(
  p: unknown,
): ValidationResult<E> {
  if (!isRecord(p) || !hasExactKeys(p, ["placement", "reason"])) return { valid: false };
  if (!isRewardedAdPlacement(p.placement) || !isAdFailureReason(p.reason)) return { valid: false };
  return { valid: true, params: { placement: p.placement, reason: p.reason } as EventParamsMap[E] };
}

/** shape_completed and its SEO-practice twin: one contract, so the two can never drift apart. */
function validateRoundResultEvent<E extends "shape_completed" | "shape_practice_completed">(
  p: unknown,
): ValidationResult<E> {
  if (!isRecord(p) || !hasExactKeys(p, ["category", "starRating", "passed", "isNewBest"])) return { valid: false };
  const { category, starRating, passed, isNewBest } = p;
  if (typeof category !== "string" || !(CATEGORY_IDS as string[]).includes(category)) return { valid: false };
  if (!isIntInRange(starRating, 0, 5)) return { valid: false };
  if (!isBoolean(passed) || !isBoolean(isNewBest)) return { valid: false };
  return { valid: true, params: { category: category as CategoryId, starRating, passed, isNewBest } as EventParamsMap[E] };
}

function validateFunnelEvent<E extends "game_started" | "game_completed" | "result_shared">(
  p: unknown,
): ValidationResult<E> {
  if (!isRecord(p) || !hasExactKeys(p, ["gameType", "category", "contentKey"])) return { valid: false };
  const { gameType, category, contentKey } = p;
  if (!isGameType(gameType)) return { valid: false };
  if (!isCategoryOrCustom(category)) return { valid: false };
  if (!isSafeString(contentKey)) return { valid: false };
  return { valid: true, params: { gameType, category, contentKey } as EventParamsMap[E] };
}

/** All-or-nothing: an unknown event name or any single invalid/extra/missing param fails the whole event. */
export function validateEventParams<E extends AnalyticsEventName>(eventName: E, params: unknown): ValidationResult<E> {
  const validator = VALIDATORS[eventName] as Validator<E> | undefined;
  if (!validator) return { valid: false };
  return validator(params);
}

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && (ANALYTICS_EVENT_NAMES as string[]).includes(value);
}

/**
 * Which client surface an event came from - the Android app vs. the website.
 * Deliberately sent as a sibling of `params` in the ingest body rather than as a
 * param, so no per-event schema changes (and no risk of it colliding with the
 * sanitizeParams denylist). Values are exactly Capacitor's `getPlatform()`
 * strings; "unknown" covers app versions shipped before this field existed, so
 * old data is never silently attributed to the wrong surface.
 *
 * This is a coarse build-type label, not a device or user identifier: it adds no
 * new data collection, and every event stays an aggregate counter increment.
 */
export const ANALYTICS_PLATFORMS = ["android", "ios", "web"] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number] | "unknown";

/** Closed-set coercion, so a malformed or hostile body can never inflate the platform counter with arbitrary keys. */
export function normalizeAnalyticsPlatform(value: unknown): AnalyticsPlatform {
  return typeof value === "string" && (ANALYTICS_PLATFORMS as readonly string[]).includes(value)
    ? (value as AnalyticsPlatform)
    : "unknown";
}

// --- Asia/Jerusalem date-range helpers, shared by ingestion (day bucket key) and the
// --- admin report (daily/weekly/monthly range math). ---

// Re-exported from the shared single source of truth so existing callers that
// import it from here (e.g. worker/analyticsDO.ts) keep working unchanged.
export { israelDateKey } from "../app/israelDate";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strict "YYYY-MM-DD" check, including rejecting out-of-range values like day 32 or month 13. */
export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_PATTERN.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Shifts a "YYYY-MM-DD" calendar date by `days`. Only ever used on calendar dates (never
 * on an actual instant), so representing it as UTC midnight for the arithmetic is safe -
 * calendar day math doesn't depend on timezone offset.
 */
function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return toDateKey(new Date(Date.UTC(y, m - 1, d + days)));
}

export type DateRange = { startDate: string; endDate: string };

/** Israel week = Sunday-Saturday. Returns the Sunday on/before `dateKey` through the following Saturday. */
export function weeklyRange(dateKey: string): DateRange {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const startDate = addDaysToDateKey(dateKey, -weekday);
  const endDate = addDaysToDateKey(startDate, 6);
  return { startDate, endDate };
}

/** Calendar month containing `dateKey`: the 1st through the last day of that month. */
export function monthlyRange(dateKey: string): DateRange {
  const [y, m] = dateKey.split("-").map(Number);
  const startDate = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
  const endDate = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { startDate, endDate };
}

/** Every "YYYY-MM-DD" date key from startDate to endDate inclusive. Capped defensively - callers only ever pass day/week/month-sized ranges. */
export function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cur = startDate;
  for (let i = 0; i < 400 && cur <= endDate; i++) {
    dates.push(cur);
    cur = addDaysToDateKey(cur, 1);
  }
  return dates;
}
