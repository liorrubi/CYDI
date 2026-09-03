// Server-side counter shaping for the new appVersion/appBuild dimensions.
//
// The point of these tests is that the new dimensions are purely ADDITIVE: no
// existing counter changes value, no legacy bucket is rewritten, and the build
// breakout stays confined to app_open so unbounded-cardinality SHAs can never
// grow every counter map.
import test from "node:test";
import assert from "node:assert/strict";

const { incrementEvent, mergeCounters } = await import("./analyticsDO.ts");

test("appVersion is recorded for every event", () => {
  let counters = incrementEvent({}, "game_started", { gameType: "shapeChallenge" }, "android", "0.40.0", "05dccc1");
  counters = incrementEvent(counters, "shape_completed", { starRating: 4, passed: true }, "android", "0.40.0", "05dccc1");
  assert.deepEqual(counters.game_started?.byAppVersion, { "0.40.0": 1 });
  assert.deepEqual(counters.shape_completed?.byAppVersion, { "0.40.0": 1 });
});

test("two releases accumulate side by side without touching totals", () => {
  let counters = incrementEvent({}, "game_started", {}, "android", "0.39.1", "62b7e91");
  counters = incrementEvent(counters, "game_started", {}, "android", "0.40.0", "05dccc1");
  counters = incrementEvent(counters, "game_started", {}, "web", "0.40.0", "05dccc1");
  assert.equal(counters.game_started?.total, 3);
  assert.deepEqual(counters.game_started?.byAppVersion, { "0.39.1": 1, "0.40.0": 2 });
  assert.deepEqual(counters.game_started?.byPlatform, { android: 2, web: 1 });
});

test("byAppBuild exists ONLY on app_open", () => {
  const opened = incrementEvent({}, "app_open", {}, "android", "0.40.0", "05dccc1");
  assert.deepEqual(opened.app_open?.byAppBuild, { "05dccc1": 1 });

  for (const name of ["game_started", "game_completed", "shape_completed", "result_shared"] as const) {
    const counters = incrementEvent({}, name, {}, "android", "0.40.0", "05dccc1");
    assert.equal(counters[name]?.byAppBuild, undefined, `${name} gets no build breakout`);
    // ...but it still gets the version, which is the cheap dimension.
    assert.deepEqual(counters[name]?.byAppVersion, { "0.40.0": 1 });
  }
});

test("a legacy envelope with neither field is still counted, under unknown", () => {
  // An older client sends no appVersion/appBuild at all: the event must be
  // recorded, never dropped, exactly like a pre-`platform` client.
  const counters = incrementEvent({}, "app_open", {}, "unknown");
  assert.equal(counters.app_open?.total, 1);
  assert.deepEqual(counters.app_open?.byAppVersion, { unknown: 1 });
  assert.deepEqual(counters.app_open?.byAppBuild, { unknown: 1 });
  assert.deepEqual(counters.app_open?.byPlatform, { unknown: 1 });
});

test("existing totals and rate inputs are byte-identical with and without the new fields", () => {
  const params = { starRating: 5, passed: true, gameType: "shapeChallenge", category: "geometric", contentKey: "geo-circle" };
  const withFields = incrementEvent({}, "shape_completed", params, "android", "0.40.0", "05dccc1").shape_completed!;
  const without = incrementEvent({}, "shape_completed", params, "android").shape_completed!;

  for (const key of ["total", "sumStarRating", "passedCount", "scoredCount"] as const) {
    assert.deepEqual(withFields[key], without[key], `${key} unchanged`);
  }
  assert.deepEqual(withFields.byPlatform, without.byPlatform);
  assert.deepEqual(withFields.byGameType, without.byGameType);
  assert.deepEqual(withFields.byCategory, without.byCategory);
  assert.deepEqual(withFields.byContentKey, without.byContentKey);
});

test("merging a legacy bucket with a new one unions the versions and leaves legacy alone", () => {
  // A day recorded before these fields existed has no byAppVersion at all. It must
  // not gain a phantom key, and merging it forward must not lose the new data.
  const legacy = incrementEvent({}, "game_started", {}, "android");
  delete legacy.game_started!.byAppVersion;
  delete legacy.game_started!.byAppBuild;
  assert.equal(legacy.game_started?.byAppVersion, undefined, "legacy bucket really has no version map");

  const modern = incrementEvent({}, "game_started", {}, "android", "0.40.0", "05dccc1");
  const merged = mergeCounters(legacy, modern);

  assert.equal(merged.game_started?.total, 2, "totals still add up across the boundary");
  assert.deepEqual(merged.game_started?.byAppVersion, { "0.40.0": 1 }, "only the events that had a version are attributed");
  assert.deepEqual(merged.game_started?.byPlatform, { android: 2 });
});

test("merging two legacy buckets leaves the new maps absent, not empty", () => {
  const a = incrementEvent({}, "game_started", {}, "android");
  const b = incrementEvent({}, "game_started", {}, "web");
  for (const c of [a, b]) {
    delete c.game_started!.byAppVersion;
    delete c.game_started!.byAppBuild;
  }
  const merged = mergeCounters(a, b);
  assert.equal(merged.game_started?.byAppVersion, undefined);
  assert.equal(merged.game_started?.byAppBuild, undefined);
  assert.equal(merged.game_started?.total, 2);
});

test("app_open build maps merge across buckets", () => {
  const day1 = incrementEvent({}, "app_open", {}, "android", "0.40.0", "05dccc1");
  const day2 = incrementEvent({}, "app_open", {}, "android", "0.40.0", "62b7e91");
  const merged = mergeCounters(day1, day2);
  assert.deepEqual(merged.app_open?.byAppBuild, { "05dccc1": 1, "62b7e91": 1 });
  assert.deepEqual(merged.app_open?.byAppVersion, { "0.40.0": 2 });
  assert.equal(merged.app_open?.total, 2);
});

test("internal and external stay separate buckets, each keeping its own versions", () => {
  // The DO writes internal and external into different storage keys; this models
  // that separation and proves a QA build and a production build of the same
  // release remain independently attributable.
  const external = incrementEvent({}, "app_open", {}, "android", "0.40.0", "05dccc1");
  const internal = incrementEvent({}, "app_open", {}, "android", "0.39.1", "62b7e91");

  assert.deepEqual(external.app_open?.byAppVersion, { "0.40.0": 1 });
  assert.deepEqual(internal.app_open?.byAppVersion, { "0.39.1": 1 });
  assert.equal(external.app_open?.total, 1, "external is not inflated by internal");
  assert.equal(internal.app_open?.total, 1, "internal is not inflated by external");

  // audience=all merges them on read only, and that merge keeps both versions.
  const both = mergeCounters(external, internal);
  assert.deepEqual(both.app_open?.byAppVersion, { "0.40.0": 1, "0.39.1": 1 });
  assert.equal(both.app_open?.total, 2);
});
