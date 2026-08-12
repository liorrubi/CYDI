import test from "node:test";
import assert from "node:assert/strict";
import { validateEventParams, weeklyRange, monthlyRange, isAnalyticsEventName, normalizeAnalyticsPlatform } from "./analyticsSchema.ts";
import { sanitizeParams } from "./analytics.ts";

// --- Each of the 8 events' real observed param shapes validates successfully ---
// (the explicit regression check that all 5 pre-existing events keep working,
// using the renamed content-identifier fields for the 3 new events and for
// artist_pack_link_clicked).

test("app_open: real call-site params (none) validate", () => {
  const result = validateEventParams("app_open", {});
  assert.equal(result.valid, true);
});

test("shape_completed: real call-site params validate", () => {
  const result = validateEventParams("shape_completed", { category: "animals", starRating: 4, passed: true, isNewBest: false });
  assert.equal(result.valid, true);
});

test("purchase_completed: real call-site params validate (all 3 product types)", () => {
  assert.equal(validateEventParams("purchase_completed", { productType: "penColor", tier: "gold", price: 200 }).valid, true);
  assert.equal(validateEventParams("purchase_completed", { productType: "chestKey", tier: "bronze", price: 50 }).valid, true);
  assert.equal(validateEventParams("purchase_completed", { productType: "megaCard", tier: "legendary", price: 500 }).valid, true);
});

test("mega_card_unlocked: real call-site params validate (all 3 rarities)", () => {
  assert.equal(validateEventParams("mega_card_unlocked", { rarity: "rare" }).valid, true);
  assert.equal(validateEventParams("mega_card_unlocked", { rarity: "epic" }).valid, true);
  assert.equal(validateEventParams("mega_card_unlocked", { rarity: "legendary" }).valid, true);
});

test("artist_pack_link_clicked: renamed artistKey/packKey params validate", () => {
  const result = validateEventParams("artist_pack_link_clicked", {
    artistKey: "nimrod-cohen",
    packKey: "nimco",
    hasAffiliate: true,
  });
  assert.equal(result.valid, true);
});

test("game_started/game_completed/result_shared: contentKey params validate for every game type", () => {
  const gameTypes = ["shapeChallenge", "dailyChallenge", "megaChallenge", "artistPack", "specialChallenge", "customChallenge"] as const;
  for (const gameType of gameTypes) {
    const category = gameType === "customChallenge" ? "custom" : "animals";
    for (const eventName of ["game_started", "game_completed", "result_shared"] as const) {
      const result = validateEventParams(eventName, { gameType, category, contentKey: "some-content-1" });
      assert.equal(result.valid, true, `${eventName} should accept gameType=${gameType}`);
    }
  }
});

// --- Explicit end-to-end pass-through: content-identifier fields must survive the
// --- real sanitizeParams denylist (not a reimplementation) and then still validate. ---

test("sanitizeParams does not strip artistKey/packKey, and the surviving params still validate", () => {
  const rawParams = { artistKey: "nimrod-cohen", packKey: "nimco", hasAffiliate: true };
  const sanitized = sanitizeParams(rawParams);
  assert.deepEqual(sanitized, rawParams);
  const result = validateEventParams("artist_pack_link_clicked", sanitized);
  assert.equal(result.valid, true);
});

test("sanitizeParams does not strip contentKey, and the surviving params still validate", () => {
  const rawParams = { gameType: "shapeChallenge", category: "geometric", contentKey: "polygon-3" };
  const sanitized = sanitizeParams(rawParams);
  assert.deepEqual(sanitized, rawParams);
  const result = validateEventParams("game_completed", sanitized);
  assert.equal(result.valid, true);
});

// --- Rejections: extra/unknown key, missing key, wrong type, out-of-range value ---

test("rejects an entirely unknown event name", () => {
  assert.equal(isAnalyticsEventName("some_made_up_event"), false);
  const result = validateEventParams("some_made_up_event" as never, {});
  assert.equal(result.valid, false);
});

test("shape_completed rejects an extra unknown param", () => {
  const result = validateEventParams("shape_completed", {
    category: "animals",
    starRating: 4,
    passed: true,
    isNewBest: false,
    extra: "nope",
  });
  assert.equal(result.valid, false);
});

test("shape_completed rejects a missing required param", () => {
  const result = validateEventParams("shape_completed", { category: "animals", starRating: 4, passed: true });
  assert.equal(result.valid, false);
});

test("shape_completed rejects starRating out of range", () => {
  assert.equal(validateEventParams("shape_completed", { category: "animals", starRating: 6, passed: true, isNewBest: false }).valid, false);
  assert.equal(validateEventParams("shape_completed", { category: "animals", starRating: -1, passed: true, isNewBest: false }).valid, false);
  assert.equal(validateEventParams("shape_completed", { category: "animals", starRating: 2.5, passed: true, isNewBest: false }).valid, false);
});

test("shape_completed rejects a wrong-typed param", () => {
  const result = validateEventParams("shape_completed", { category: "animals", starRating: "4", passed: true, isNewBest: false });
  assert.equal(result.valid, false);
});

test("purchase_completed rejects a negative price and an unknown productType", () => {
  assert.equal(validateEventParams("purchase_completed", { productType: "penColor", tier: "gold", price: -1 }).valid, false);
  assert.equal(validateEventParams("purchase_completed", { productType: "subscription", tier: "gold", price: 5 }).valid, false);
});

test("mega_card_unlocked rejects an unknown rarity", () => {
  assert.equal(validateEventParams("mega_card_unlocked", { rarity: "mythic" }).valid, false);
});

test("game_started rejects an unknown gameType and an unknown category", () => {
  assert.equal(validateEventParams("game_started", { gameType: "arcadeMode", category: "animals", contentKey: "x" }).valid, false);
  assert.equal(validateEventParams("game_started", { gameType: "shapeChallenge", category: "not-a-category", contentKey: "x" }).valid, false);
});

test("game_started rejects an oversized/invalid-charset contentKey", () => {
  const tooLong = "x".repeat(65);
  assert.equal(validateEventParams("game_started", { gameType: "shapeChallenge", category: "animals", contentKey: tooLong }).valid, false);
  assert.equal(
    validateEventParams("game_started", { gameType: "shapeChallenge", category: "animals", contentKey: "has spaces" }).valid,
    false,
  );
});

test("app_open rejects any param at all", () => {
  assert.equal(validateEventParams("app_open", { anything: "here" }).valid, false);
});

// --- Reward-offer funnel events (DoubleCoinsOffer) - same {placement}-only shape,
// --- a separate namespace from the rewarded_ad_* SDK-lifecycle events. ---

test("all 6 reward_* offer-funnel events accept {placement} for every real placement", () => {
  const events = [
    "reward_offer_shown",
    "reward_ad_started",
    "reward_ad_completed",
    "reward_ad_failed",
    "reward_skipped",
    "reward_fallback_used",
  ] as const;
  for (const eventName of events) {
    assert.equal(validateEventParams(eventName, { placement: "shape_challenge_double_reward" }).valid, true, eventName);
  }
});

test("reward_* events reject an unknown placement, a missing placement, and an extra key", () => {
  assert.equal(validateEventParams("reward_offer_shown", { placement: "hacked" }).valid, false);
  assert.equal(validateEventParams("reward_ad_started", {}).valid, false);
  assert.equal(
    validateEventParams("reward_ad_completed", { placement: "daily_retry", extra: 1 }).valid,
    false,
  );
});

test("reward_* events are a distinct namespace from rewarded_ad_* (no accidental collision)", () => {
  assert.equal(isAnalyticsEventName("reward_ad_completed"), true);
  assert.equal(isAnalyticsEventName("rewarded_ad_completed"), true);
  // Each validates independently under its own schema entry.
  assert.equal(validateEventParams("reward_ad_completed", { placement: "daily_retry" }).valid, true);
  assert.equal(validateEventParams("rewarded_ad_completed", { placement: "daily_retry" }).valid, true);
});

// --- Weekly range helper: Israel week = Sunday-Saturday ---

test("weeklyRange always returns a Sunday..Saturday span containing the input date", () => {
  const dates = ["2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"];
  for (const dateKey of dates) {
    const { startDate, endDate } = weeklyRange(dateKey);
    const startWeekday = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    const endWeekday = new Date(`${endDate}T00:00:00Z`).getUTCDay();
    assert.equal(startWeekday, 0, `startDate ${startDate} (from ${dateKey}) should be a Sunday`);
    assert.equal(endWeekday, 6, `endDate ${endDate} (from ${dateKey}) should be a Saturday`);
    assert.ok(startDate <= dateKey && dateKey <= endDate, `${dateKey} should fall within [${startDate}, ${endDate}]`);
    const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
    const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
    assert.equal((endMs - startMs) / (24 * 60 * 60 * 1000), 6, "week span should be exactly 6 days");
  }
});

// --- Monthly range helper: calendar month bounds ---

test("monthlyRange handles a 31-day month", () => {
  assert.deepEqual(monthlyRange("2026-01-15"), { startDate: "2026-01-01", endDate: "2026-01-31" });
});

test("monthlyRange handles a 30-day month", () => {
  assert.deepEqual(monthlyRange("2026-04-15"), { startDate: "2026-04-01", endDate: "2026-04-30" });
});

test("monthlyRange handles February in a leap year", () => {
  assert.deepEqual(monthlyRange("2024-02-10"), { startDate: "2024-02-01", endDate: "2024-02-29" });
});

test("monthlyRange handles February in a non-leap year", () => {
  assert.deepEqual(monthlyRange("2026-02-10"), { startDate: "2026-02-01", endDate: "2026-02-28" });
});

// --- Platform split (Android app vs. website). It rides alongside `params`, so it must
// --- never leak into a validated event's params, and must always coerce to a closed set. ---

test("normalizeAnalyticsPlatform accepts only the real platform strings", () => {
  assert.equal(normalizeAnalyticsPlatform("android"), "android");
  assert.equal(normalizeAnalyticsPlatform("ios"), "ios");
  assert.equal(normalizeAnalyticsPlatform("web"), "web");
});

test("normalizeAnalyticsPlatform coerces anything else to 'unknown' rather than trusting it", () => {
  // An older client that predates the field, plus values a hostile body could send.
  assert.equal(normalizeAnalyticsPlatform(undefined), "unknown");
  assert.equal(normalizeAnalyticsPlatform(null), "unknown");
  assert.equal(normalizeAnalyticsPlatform("Android"), "unknown");
  assert.equal(normalizeAnalyticsPlatform("../../etc"), "unknown");
  assert.equal(normalizeAnalyticsPlatform(42), "unknown");
  assert.equal(normalizeAnalyticsPlatform({ platform: "web" }), "unknown");
});

test("a platform sent inside params is still rejected - it is a sibling of params, never a param", () => {
  const result = validateEventParams("app_open", { platform: "android" });
  assert.equal(result.valid, false);
});
