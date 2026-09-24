// Server-side validation and counter shaping for the interstitial experiment and the
// native appVersionCode, plus a guard against the `byInstallAge` class of bug: a
// counter map that incrementEvent writes but mergeCounters forgets, so every
// multi-day (and every external+internal) report silently loses it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { incrementEvent, mergeCounters } = await import("./analyticsDO.ts");
const { validateEventParams, isAnalyticsEventName, normalizeAppVersionCode } = await import("../src/services/analyticsSchema.ts");
const { INTERSTITIAL_OUTCOMES, INTERSTITIAL_FAILURE_REASONS, INTERSTITIAL_CADENCES } = await import(
  "../src/services/ads/interstitialConfigSchema.ts"
);

// --- Validators ---------------------------------------------------------------------

test("the four interstitial events are known event names", () => {
  for (const name of ["interstitial_checkpoint", "interstitial_continuation", "interstitial_load_failed", "interstitial_dismissed"]) {
    assert.equal(isAnalyticsEventName(name), true, name);
  }
});

test("interstitial_checkpoint accepts exactly the valid arm/outcome pairs", () => {
  const ok = (p: unknown) => validateEventParams("interstitial_checkpoint", p).valid;
  assert.equal(ok({ arm: "control", outcome: "control", gamesBetweenAds: 7 }), true);
  assert.equal(ok({ arm: "control", outcome: "suppressed", gamesBetweenAds: 7 }), true);
  for (const outcome of ["not_ready", "shown", "suppressed"]) {
    assert.equal(ok({ arm: "treatment", outcome, gamesBetweenAds: 10 }), true, outcome);
  }
  assert.equal(ok({ arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "timeout" }), true);
  // Impossible pairs, missing/extra keys, out-of-set values.
  assert.equal(ok({ arm: "control", outcome: "shown", gamesBetweenAds: 7 }), false, "control never shows");
  assert.equal(ok({ arm: "treatment", outcome: "control", gamesBetweenAds: 7 }), false);
  assert.equal(ok({ arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7 }), false, "show_failed needs a reason");
  assert.equal(ok({ arm: "treatment", outcome: "shown", gamesBetweenAds: 7, reason: "timeout" }), false, "only show_failed has a reason");
  assert.equal(ok({ arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "No fill." }), false, "no raw SDK text");
  assert.equal(ok({ arm: "treatment", outcome: "pending", gamesBetweenAds: 7 }), false, "no public pending outcome");
  assert.equal(ok({ arm: "treatment", outcome: "capped", gamesBetweenAds: 7 }), false, "no capped outcome");
  assert.equal(ok({ arm: "unassigned", outcome: "control", gamesBetweenAds: 7 }), false);
  assert.equal(ok({ arm: "treatment", outcome: "shown", gamesBetweenAds: 8 }), false);
  assert.equal(ok({ arm: "treatment", outcome: "shown", gamesBetweenAds: 7, opportunityId: "x" }), false, "no opportunity id");
});

test("continuation, load_failed and dismissed validators are closed", () => {
  const v = validateEventParams;
  assert.equal(v("interstitial_continuation", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7 }).valid, true);
  assert.equal(v("interstitial_continuation", { arm: "treatment", outcome: "shown" }).valid, false);
  assert.equal(v("interstitial_continuation", { arm: "control", outcome: "not_ready", gamesBetweenAds: 7 }).valid, false);
  for (const reason of INTERSTITIAL_FAILURE_REASONS) assert.equal(v("interstitial_load_failed", { reason }).valid, true, reason);
  assert.equal(v("interstitial_load_failed", { reason: "consent_blocked" }).valid, false);
  assert.equal(v("interstitial_load_failed", { reason: "no_fill", code: 3 }).valid, false);
  assert.equal(v("interstitial_dismissed", {}).valid, true);
  assert.equal(v("interstitial_dismissed", { latencyMs: 5 }).valid, false);
});

test("the bounded vocabularies are exactly what the design specifies", () => {
  assert.deepEqual([...INTERSTITIAL_OUTCOMES], ["control", "not_ready", "shown", "show_failed", "suppressed"]);
  assert.deepEqual([...INTERSTITIAL_FAILURE_REASONS], ["no_fill", "network_error", "not_configured", "timeout", "sdk_error"]);
  assert.deepEqual([...INTERSTITIAL_CADENCES], [5, 7, 10, 12, 15, 20]);
});

// --- Counter shaping ----------------------------------------------------------------

function checkpoint(counters: object, params: Record<string, unknown>, country = "DE") {
  return incrementEvent(counters, "interstitial_checkpoint", params, "android", "0.53.0", "abc1234", undefined, country);
}

test("checkpoint and continuation get byArmOutcome and byCadence; checkpoint gets byCountry", () => {
  let c = checkpoint({}, { arm: "treatment", outcome: "shown", gamesBetweenAds: 7 });
  c = checkpoint(c, { arm: "control", outcome: "suppressed", gamesBetweenAds: 7 }, "IL");
  c = checkpoint(c, { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 10, reason: "timeout" });
  assert.deepEqual(c.interstitial_checkpoint?.byArmOutcome, { "treatment|shown": 1, "control|suppressed": 1, "treatment|show_failed": 1 });
  assert.deepEqual(c.interstitial_checkpoint?.byCadence, { "7": 2, "10": 1 });
  assert.deepEqual(c.interstitial_checkpoint?.byInterstitialReason, { timeout: 1 });
  assert.deepEqual(c.interstitial_checkpoint?.byCountry, { DE: 2, IL: 1 });
  const cont = incrementEvent({}, "interstitial_continuation", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7 }, "android");
  assert.deepEqual(cont.interstitial_continuation?.byArmOutcome, { "treatment|not_ready": 1 });
  assert.deepEqual(cont.interstitial_continuation?.byCadence, { "7": 1 });
  assert.equal(cont.interstitial_continuation?.byCountry, undefined, "continuation is not country-crossed");
});

test("load_failed gets byInterstitialReason only; hostile values open no key", () => {
  const c = incrementEvent({}, "interstitial_load_failed", { reason: "no_fill" }, "android");
  assert.deepEqual(c.interstitial_load_failed?.byInterstitialReason, { no_fill: 1 });
  assert.equal(c.interstitial_load_failed?.byArmOutcome, undefined);
  const hostile = checkpoint({}, { arm: "x", outcome: "y", gamesBetweenAds: 999, reason: "free text" });
  assert.equal(hostile.interstitial_checkpoint?.byArmOutcome, undefined);
  assert.equal(hostile.interstitial_checkpoint?.byCadence, undefined);
  assert.equal(hostile.interstitial_checkpoint?.byInterstitialReason, undefined);
});

test("byAppVersionCode is Android app_open only, format-closed", () => {
  const a = incrementEvent({}, "app_open", {}, "android", "0.53.0", "abc1234", undefined, "DE", "46");
  assert.deepEqual(a.app_open?.byAppVersionCode, { "46": 1 });
  const older = incrementEvent(a, "app_open", {}, "android", "0.51.0", "abc1234", undefined, "DE");
  assert.deepEqual(older.app_open?.byAppVersionCode, { "46": 1, unknown: 1 }, "a client older than 0.53.0 counts as unknown");
  const web = incrementEvent({}, "app_open", {}, "web", "0.53.0", "abc1234", undefined, "DE", "46");
  assert.equal(web.app_open?.byAppVersionCode, undefined, "no web row");
  const game = incrementEvent({}, "game_started", { gameType: "shapeChallenge", category: "geometric", contentKey: "k" }, "android", "0.53.0", "abc1234", undefined, "DE", "46");
  assert.equal(game.game_started?.byAppVersionCode, undefined, "app_open only");
  const hostile = incrementEvent({}, "app_open", {}, "android", "0.53.0", "abc1234", undefined, "DE", "<script>");
  assert.deepEqual(hostile.app_open?.byAppVersionCode, { unknown: 1 });
  assert.equal(normalizeAppVersionCode(46), "46");
  assert.equal(normalizeAppVersionCode("046"), "unknown");
  assert.equal(normalizeAppVersionCode("1234567890"), "unknown");
});

// --- mergeCounters (the byInstallAge class of bug) -----------------------------------

test("every new interstitial / versionCode map survives mergeCounters", () => {
  let day1 = checkpoint({}, { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "sdk_error" });
  day1 = incrementEvent(day1, "interstitial_continuation", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7 }, "android");
  day1 = incrementEvent(day1, "interstitial_load_failed", { reason: "network_error" }, "android");
  day1 = incrementEvent(day1, "app_open", {}, "android", "0.53.0", "abc1234", undefined, "DE", "46");
  let day2 = checkpoint({}, { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "sdk_error" }, "IL");
  day2 = incrementEvent(day2, "interstitial_continuation", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7 }, "android");
  day2 = incrementEvent(day2, "interstitial_load_failed", { reason: "no_fill" }, "android");
  day2 = incrementEvent(day2, "app_open", {}, "android", "0.53.0", "abc1234", undefined, "DE", "47");
  day2 = incrementEvent(day2, "interstitial_dismissed", {}, "android");

  const merged = mergeCounters(day1, day2);
  assert.deepEqual(merged.interstitial_checkpoint?.byArmOutcome, { "treatment|show_failed": 2 });
  assert.deepEqual(merged.interstitial_checkpoint?.byCadence, { "7": 2 });
  assert.deepEqual(merged.interstitial_checkpoint?.byInterstitialReason, { sdk_error: 2 });
  assert.deepEqual(merged.interstitial_checkpoint?.byCountry, { DE: 1, IL: 1 });
  assert.deepEqual(merged.interstitial_continuation?.byArmOutcome, { "treatment|shown": 2 });
  assert.deepEqual(merged.interstitial_continuation?.byCadence, { "7": 2 });
  assert.deepEqual(merged.interstitial_load_failed?.byInterstitialReason, { network_error: 1, no_fill: 1 });
  assert.deepEqual(merged.app_open?.byAppVersionCode, { "46": 1, "47": 1 });
  assert.equal(merged.interstitial_dismissed?.total, 1);

  // Legacy buckets (no such maps) stay without phantom keys.
  const legacy = mergeCounters({ app_open: { total: 3 } }, { app_open: { total: 2 } });
  assert.equal(legacy.app_open?.byAppVersionCode, undefined);
  assert.equal(legacy.app_open?.total, 5);
});

test("CLASS GUARD: every EventCounters map declared in analyticsDO.ts is merged by mergeCounters", () => {
  // The byInstallAge bug was a field added to EventCounters and incrementEvent but
  // not to mergeCounters - invisible in single-day reports, lost in every range.
  // This reads the source so ANY future map forgotten there fails here, not in a
  // report weeks later.
  const source = readFileSync(new URL("./analyticsDO.ts", import.meta.url), "utf8");
  const typeBlock = source.slice(source.indexOf("type EventCounters = {"), source.indexOf("};", source.indexOf("type EventCounters = {")));
  const mapFields = [...typeBlock.matchAll(/^\s+(by[A-Za-z]+)\?: Record<string, number>;/gm)].map((m) => m[1]);
  const sumFields = [...typeBlock.matchAll(/^\s+([a-zA-Z]+)\?: number;/gm)].map((m) => m[1]);
  assert.ok(mapFields.includes("byInstallAge") && mapFields.includes("byArmOutcome") && mapFields.includes("byAppVersionCode"));
  const mergeBlock = source.slice(source.indexOf("export function mergeCounters"), source.indexOf("/** Constant-time string compare"));
  for (const field of mapFields) {
    assert.ok(mergeBlock.includes(`${field}: mergeKeyMaps(ae.${field}, be.${field})`), `mergeCounters drops ${field}`);
  }
  for (const field of sumFields) {
    assert.ok(mergeBlock.includes(`${field}: mergeOptionalSum(ae.${field}, be.${field})`), `mergeCounters drops ${field}`);
  }
});

test("CLASS GUARD (behavioural): merging a bucket with an empty one loses nothing", () => {
  let c = checkpoint({}, { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 12, reason: "timeout" });
  c = incrementEvent(c, "app_open", {}, "android", "0.53.0", "abc1234", undefined, "DE", "46");
  c = incrementEvent(c, "first_open", { installAge: "h0_24" }, "android", "0.53.0", "abc1234", undefined, "DE");
  c = incrementEvent(c, "interstitial_load_failed", { reason: "not_configured" }, "android");
  const strip = (o: object) => JSON.parse(JSON.stringify(o));
  assert.deepEqual(strip(mergeCounters({}, c)), strip(c));
  assert.deepEqual(strip(mergeCounters(c, {})), strip(c));
});
