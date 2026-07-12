import test from "node:test";
import assert from "node:assert/strict";
import { validateEventParams, weeklyRange, monthlyRange, isAnalyticsEventName } from "./analyticsSchema.ts";
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
