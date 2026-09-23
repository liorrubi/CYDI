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

// --- Web -> Google Play install funnel: the bySurface breakout ---------------
//
// Same guarantees the appVersion/appBuild dimensions above are held to: additive,
// bounded, confined to the events that declare it, and harmless to buckets
// recorded before it existed.

test("bySurface exists ONLY on the two play_store_* events", () => {
  const shown = incrementEvent({}, "play_store_cta_shown", { surface: "results" }, "web", "0.40.0", "05dccc1");
  const clicked = incrementEvent({}, "play_store_click", { surface: "seo_star" }, "web", "0.40.0", "05dccc1");
  assert.deepEqual(shown.play_store_cta_shown?.bySurface, { results: 1 });
  assert.deepEqual(clicked.play_store_click?.bySurface, { seo_star: 1 });

  // A `surface` sent on any other event is validated away client-side and, even if
  // it reached here, must never open a breakout map on an event that never declared one.
  const started = incrementEvent({}, "game_started", { gameType: "shapeChallenge", surface: "results" }, "web", "0.40.0", "05dccc1");
  const opened = incrementEvent({}, "app_open", { surface: "results" }, "web", "0.40.0", "05dccc1");
  assert.equal(started.game_started?.bySurface, undefined);
  assert.equal(opened.app_open?.bySurface, undefined);
});

test("the play_store_* events get no build breakout, and app_open gets no surface one", () => {
  const clicked = incrementEvent({}, "play_store_click", { surface: "seo_circle" }, "web", "0.40.0", "05dccc1");
  assert.equal(clicked.play_store_click?.byAppBuild, undefined);
  // The dimensions every event keeps are still there.
  assert.deepEqual(clicked.play_store_click?.byPlatform, { web: 1 });
  assert.deepEqual(clicked.play_store_click?.byAppVersion, { "0.40.0": 1 });
  assert.equal(clicked.play_store_click?.total, 1);
});

test("every surface accumulates side by side without touching totals", () => {
  let counters = incrementEvent({}, "play_store_cta_shown", { surface: "results" }, "web", "0.40.0", "05dccc1");
  for (const surface of ["seo_circle", "seo_star", "seo_heart", "results"]) {
    counters = incrementEvent(counters, "play_store_cta_shown", { surface }, "web", "0.40.0", "05dccc1");
  }
  assert.deepEqual(counters.play_store_cta_shown?.bySurface, {
    results: 2,
    seo_circle: 1,
    seo_star: 1,
    seo_heart: 1,
  });
  assert.equal(counters.play_store_cta_shown?.total, 5);
});

test("impressions and clicks are counted independently, so a CTR is derivable per surface", () => {
  let counters = incrementEvent({}, "play_store_cta_shown", { surface: "seo_star" }, "web", "0.40.0", "05dccc1");
  for (let i = 0; i < 3; i += 1) {
    counters = incrementEvent(counters, "play_store_cta_shown", { surface: "seo_star" }, "web", "0.40.0", "05dccc1");
  }
  counters = incrementEvent(counters, "play_store_click", { surface: "seo_star" }, "web", "0.40.0", "05dccc1");
  const shown = counters.play_store_cta_shown?.bySurface?.seo_star ?? 0;
  const clicked = counters.play_store_click?.bySurface?.seo_star ?? 0;
  assert.equal(shown, 4);
  assert.equal(clicked, 1);
  assert.equal(clicked / shown, 0.25);
});

test("surface maps merge across buckets, and a legacy bucket stays legacy", () => {
  const day1 = incrementEvent({}, "play_store_click", { surface: "results" }, "web", "0.40.0", "05dccc1");
  const day2 = incrementEvent({}, "play_store_click", { surface: "seo_heart" }, "web", "0.40.0", "05dccc1");
  const merged = mergeCounters(day1, day2);
  assert.deepEqual(merged.play_store_click?.bySurface, { results: 1, seo_heart: 1 });
  assert.equal(merged.play_store_click?.total, 2);

  // A day bucket written before bySurface existed has no such map; merging two of
  // them must leave it absent rather than inventing an empty object.
  const legacyA = { play_store_click: { total: 3 } };
  const legacyB = { play_store_click: { total: 2 } };
  const legacyMerged = mergeCounters(legacyA, legacyB);
  assert.equal(legacyMerged.play_store_click?.bySurface, undefined);
  assert.equal(legacyMerged.play_store_click?.total, 5);

  // And merging a legacy bucket with a new one keeps only the new one's surfaces,
  // rather than back-attributing history that was never recorded.
  const mixed = mergeCounters(legacyA, day2);
  assert.deepEqual(mixed.play_store_click?.bySurface, { seo_heart: 1 });
  assert.equal(mixed.play_store_click?.total, 4);
});

test("adding the funnel events leaves every pre-existing counter byte-identical", () => {
  const before = incrementEvent({}, "game_started", { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, "web", "0.40.0", "05dccc1");
  const after = incrementEvent(before, "play_store_click", { surface: "results" }, "web", "0.40.0", "05dccc1");
  assert.deepEqual(after.game_started, before.game_started);
});

// --- Rewarded-ad failures: the byReason breakout -----------------------------
//
// Same guarantees as the two breakouts above - additive, bounded, confined to the
// events that declare it, harmless to buckets recorded before it existed - plus one
// of its own: the value is a closed union, so no free-text key can ever be stored.

test("byReason exists ONLY on the two rewarded_ad_* events that carry a reason", () => {
  const failed = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  const unavailable = incrementEvent({}, "rewarded_ad_unavailable", { placement: "doubleCoins", reason: "consent_blocked" }, "android", "0.44.0", "4a44dc9");
  assert.deepEqual(failed.rewarded_ad_failed?.byReason, { timeout: 1 });
  assert.deepEqual(unavailable.rewarded_ad_unavailable?.byReason, { consent_blocked: 1 });

  // reward_ad_failed is the OFFER-funnel twin, a different event carrying only
  // `placement` - it must not gain a reason map even if a reason reached here.
  const offerFailed = incrementEvent({}, "reward_ad_failed", { placement: "doubleCoins", reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  assert.equal(offerFailed.reward_ad_failed?.byReason, undefined);
  assert.equal(offerFailed.reward_ad_failed?.total, 1);

  // And no unrelated event opens one either.
  const opened = incrementEvent({}, "app_open", { reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  assert.equal(opened.app_open?.byReason, undefined);
});

test("a reason outside AD_FAILURE_REASONS opens no key at all", () => {
  // handleEvent rejects these before they reach storage; this is the direct-call
  // guarantee, so a bad value can never become a free-text key.
  for (const reason of ["ECONNRESET: socket hang up", "", "TIMEOUT", 42, null, undefined]) {
    const counters = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason }, "android", "0.44.0", "4a44dc9");
    assert.equal(counters.rewarded_ad_failed?.byReason, undefined, `${String(reason)} stores no reason`);
    // The event itself is still counted - a breakout we cannot shape is never a
    // reason to lose the event.
    assert.equal(counters.rewarded_ad_failed?.total, 1);
    assert.deepEqual(counters.rewarded_ad_failed?.byPlatform, { android: 1 });
  }
});

test("every reason accumulates side by side without touching totals", () => {
  let counters = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  for (const reason of ["sdk_error", "timeout", "load_failed"]) {
    counters = incrementEvent(counters, "rewarded_ad_failed", { placement: "doubleCoins", reason }, "android", "0.44.0", "4a44dc9");
  }
  assert.deepEqual(counters.rewarded_ad_failed?.byReason, { timeout: 2, sdk_error: 1, load_failed: 1 });
  assert.equal(counters.rewarded_ad_failed?.total, 4);
  assert.deepEqual(counters.rewarded_ad_failed?.byAppVersion, { "0.44.0": 4 });
});

test("existing counters are byte-identical with and without a reason", () => {
  // The daily report's shape for every OTHER event must not move at all.
  const withReason = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "sdk_error" }, "android", "0.44.0", "4a44dc9").rewarded_ad_failed!;
  const without = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "not-a-reason" }, "android", "0.44.0", "4a44dc9").rewarded_ad_failed!;
  assert.equal(withReason.total, without.total);
  assert.deepEqual(withReason.byPlatform, without.byPlatform);
  assert.deepEqual(withReason.byAppVersion, without.byAppVersion);
  // The rewarded events get no build/surface/attribution breakouts either way.
  for (const key of ["byAppBuild", "bySurface", "bySource", "byGameType", "scoredCount"] as const) {
    assert.equal(withReason[key], undefined, `${key} stays absent`);
    assert.equal(without[key], undefined, `${key} stays absent`);
  }

  const other = incrementEvent({}, "game_started", { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, "web", "0.44.0", "4a44dc9");
  const after = incrementEvent(other, "rewarded_ad_failed", { placement: "doubleCoins", reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  assert.deepEqual(after.game_started, other.game_started);
});

test("reason maps survive the merge a range report is built from", () => {
  // period=range/weekly/monthly reads one bucket per day and mergeCounters them, so
  // a dimension that merges wrong is invisible on the daily report and silently
  // wrong on every multi-day one.
  const day1 = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  const day2 = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "sdk_error" }, "android", "0.44.0", "4a44dc9");
  const day3 = incrementEvent({}, "rewarded_ad_failed", { placement: "doubleCoins", reason: "timeout" }, "android", "0.44.0", "4a44dc9");
  const merged = mergeCounters(mergeCounters(day1, day2), day3);
  assert.deepEqual(merged.rewarded_ad_failed?.byReason, { timeout: 2, sdk_error: 1 });
  assert.equal(merged.rewarded_ad_failed?.total, 3);

  // A day bucket written before byReason existed has no such map; merging two of
  // them must leave it absent rather than inventing an empty object.
  const legacyA = { rewarded_ad_failed: { total: 4 } };
  const legacyB = { rewarded_ad_failed: { total: 1 } };
  const legacyMerged = mergeCounters(legacyA, legacyB);
  assert.equal(legacyMerged.rewarded_ad_failed?.byReason, undefined);
  assert.equal(legacyMerged.rewarded_ad_failed?.total, 5);

  // And merging history with a new day keeps only the new day's reasons, rather than
  // back-attributing failures whose reason was never stored.
  const mixed = mergeCounters(legacyA, day2);
  assert.deepEqual(mixed.rewarded_ad_failed?.byReason, { sdk_error: 1 });
  assert.equal(mixed.rewarded_ad_failed?.total, 5);
});

// --- Android install attribution (INSTALL_REFERRER_NOTES.md) -------------------------

test("byInstallAge exists ONLY on first_open, and is bounded by the closed bucket set", () => {
  const opened = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234");
  assert.deepEqual(opened.first_open?.byInstallAge, { h0_24: 1 });

  // install_attributed carries no params at all, so it can never grow one.
  const attributed = incrementEvent({}, "install_attributed", {}, "android", "0.50.0", "abc1234");
  assert.equal(attributed.install_attributed?.byInstallAge, undefined);
  assert.equal(attributed.install_attributed?.total, 1);

  // A value outside INSTALL_AGE_PARAMS leaves the map untouched rather than opening a
  // free-text key - incrementEvent is exported and called directly, so the guard has to
  // live here and not only in the request handler.
  const hostile = incrementEvent({}, "first_open", { installAge: "../../etc" }, "android", "0.50.0", "abc1234");
  assert.equal(hostile.first_open?.byInstallAge, undefined);
  assert.equal(hostile.first_open?.total, 1, "the event still counts; only the breakout is refused");
});

test("both install events keep an attribution breakout, and first_open's is the install source", () => {
  const attribution = { source: "youtube", medium: "shorts", campaign: "cydi_shorts", content: "UWZ8uIOM3XU", term: "unknown" };
  let counters = incrementEvent({}, "install_attributed", {}, "android", "0.50.0", "abc1234", attribution);
  counters = incrementEvent(counters, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", attribution);

  assert.deepEqual(counters.install_attributed?.bySource, { youtube: 1 });
  assert.deepEqual(counters.first_open?.bySource, { youtube: 1 });
  assert.deepEqual(counters.first_open?.byCampaign, { cydi_shorts: 1 });
  assert.deepEqual(counters.first_open?.byUtmContent, { UWZ8uIOM3XU: 1 });
});

test("an install event with no attribution records no source row rather than a guessed one", () => {
  const counters = incrementEvent({}, "first_open", { installAge: "unknown" }, "android", "0.50.0", "abc1234");
  assert.equal(counters.first_open?.bySource, undefined);
  assert.deepEqual(counters.first_open?.byInstallAge, { unknown: 1 });
});

// --- Pass & Play: game length and progress ------------------------------------
//
// Baseline telemetry for the 10-round default, collected BEFORE the default is
// changed. Same guarantees as the breakouts above - additive, bounded, confined to
// the events that already carry the field - plus the asymmetry that matters here:
// pp_round_completed has a roundIndex but no roundCount, so it gets one map and not
// the other. pp_abandoned fires only from the explicit quit confirmation, so its
// byRoundIndex is a floor on drop-out; pp_round_completed.byRoundIndex is the map that
// shows how far games actually get.

test("byRoundCount is kept for the three events that carry roundCount", () => {
  const started = incrementEvent({}, "pp_game_started", { playerCount: 2, roundCount: 10, difficulty: "mixed" }, "android", "0.50.0", "abc1234");
  const finished = incrementEvent({}, "pp_game_finished", { playerCount: 2, roundCount: 5 }, "android", "0.50.0", "abc1234");
  const quit = incrementEvent({}, "pp_abandoned", { roundIndex: 3, playerCount: 2, roundCount: 15 }, "android", "0.50.0", "abc1234");
  assert.deepEqual(started.pp_game_started?.byRoundCount, { "10": 1 });
  assert.deepEqual(finished.pp_game_finished?.byRoundCount, { "5": 1 });
  assert.deepEqual(quit.pp_abandoned?.byRoundCount, { "15": 1 });
});

test("byRoundIndex is kept for the two events that carry roundIndex", () => {
  const round = incrementEvent({}, "pp_round_completed", { roundIndex: 0, playerCount: 2, submitted: true }, "android", "0.50.0", "abc1234");
  const quit = incrementEvent({}, "pp_abandoned", { roundIndex: 3, playerCount: 2, roundCount: 10 }, "android", "0.50.0", "abc1234");
  assert.deepEqual(round.pp_round_completed?.byRoundIndex, { "0": 1 });
  assert.deepEqual(quit.pp_abandoned?.byRoundIndex, { "3": 1 });
});

test("pp_round_completed gets NO byRoundCount - the event does not carry one", () => {
  // The asymmetry is deliberate: inventing a length here would mean guessing it.
  const round = incrementEvent({}, "pp_round_completed", { roundIndex: 2, playerCount: 2, submitted: false }, "android", "0.50.0", "abc1234");
  assert.equal(round.pp_round_completed?.byRoundCount, undefined);
  assert.deepEqual(round.pp_round_completed?.byRoundIndex, { "2": 1 });
});

test("the round maps exist ONLY on the pass-play events that declare them", () => {
  const rematch = incrementEvent({}, "pp_rematch", { playerCount: 2 }, "android", "0.50.0", "abc1234");
  assert.equal(rematch.pp_rematch?.byRoundCount, undefined);
  assert.equal(rematch.pp_rematch?.byRoundIndex, undefined);

  // Play Together carries the same-shaped params and must not gain the maps - this
  // change is Pass & Play only.
  const mp = incrementEvent({}, "mp_game_started", { playerCount: 2, roundCount: 10, difficulty: "mixed" }, "web", "0.50.0", "abc1234");
  assert.equal(mp.mp_game_started?.byRoundCount, undefined);
  const mpRound = incrementEvent({}, "mp_round_completed", { roundIndex: 1, playerCount: 2, submitted: true }, "web", "0.50.0", "abc1234");
  assert.equal(mpRound.mp_round_completed?.byRoundIndex, undefined);

  // And an unrelated event with a stray field opens nothing.
  const opened = incrementEvent({}, "app_open", { roundCount: 10, roundIndex: 1 }, "web", "0.50.0", "abc1234");
  assert.equal(opened.app_open?.byRoundCount, undefined);
  assert.equal(opened.app_open?.byRoundIndex, undefined);
});

test("round values outside the closed domains are never persisted", () => {
  for (const roundCount of [7, 0, -5, 20, "10", null, undefined, {}]) {
    const c = incrementEvent({}, "pp_game_started", { playerCount: 2, roundCount, difficulty: "mixed" }, "android", "0.50.0", "abc1234");
    assert.equal(c.pp_game_started?.byRoundCount, undefined, `roundCount ${String(roundCount)} stores nothing`);
    assert.equal(c.pp_game_started?.total, 1, "the event is still counted");
  }
  for (const roundIndex of [-1, 15, 99, 1.5, "3", null, undefined]) {
    const c = incrementEvent({}, "pp_round_completed", { roundIndex, playerCount: 2, submitted: true }, "android", "0.50.0", "abc1234");
    assert.equal(c.pp_round_completed?.byRoundIndex, undefined, `roundIndex ${String(roundIndex)} stores nothing`);
    assert.equal(c.pp_round_completed?.total, 1, "the event is still counted");
  }
});

test("every length and index accumulates side by side without touching totals", () => {
  let c = {};
  for (const roundCount of [10, 10, 5, 15, 10]) {
    c = incrementEvent(c, "pp_game_started", { playerCount: 2, roundCount, difficulty: "mixed" }, "android", "0.50.0", "abc1234");
  }
  for (let i = 0; i < 4; i += 1) {
    c = incrementEvent(c, "pp_round_completed", { roundIndex: i, playerCount: 2, submitted: true }, "android", "0.50.0", "abc1234");
  }
  c = incrementEvent(c, "pp_round_completed", { roundIndex: 0, playerCount: 2, submitted: true }, "android", "0.50.0", "abc1234");
  const started = (c as Record<string, { total: number; byRoundCount?: Record<string, number>; byPlatform?: Record<string, number> }>).pp_game_started;
  const rounds = (c as Record<string, { total: number; byRoundIndex?: Record<string, number> }>).pp_round_completed;
  assert.deepEqual(started.byRoundCount, { "10": 3, "5": 1, "15": 1 });
  assert.equal(started.total, 5);
  assert.deepEqual(started.byPlatform, { android: 5 });
  // The survival curve: 2 games reached round 1, one each reached rounds 2 and 3.
  assert.deepEqual(rounds.byRoundIndex, { "0": 2, "1": 1, "2": 1, "3": 1 });
  assert.equal(rounds.total, 5);
});

test("the round maps survive the merge a range report is built from", () => {
  const day1 = incrementEvent({}, "pp_abandoned", { roundIndex: 1, playerCount: 2, roundCount: 10 }, "android", "0.50.0", "abc1234");
  const day2 = incrementEvent({}, "pp_abandoned", { roundIndex: 1, playerCount: 2, roundCount: 5 }, "android", "0.50.0", "abc1234");
  const day3 = incrementEvent({}, "pp_abandoned", { roundIndex: 4, playerCount: 2, roundCount: 10 }, "android", "0.50.0", "abc1234");
  const merged = mergeCounters(mergeCounters(day1, day2), day3);
  assert.deepEqual(merged.pp_abandoned?.byRoundCount, { "10": 2, "5": 1 });
  assert.deepEqual(merged.pp_abandoned?.byRoundIndex, { "1": 2, "4": 1 });
  assert.equal(merged.pp_abandoned?.total, 3);

  // Buckets written before these fields existed must stay without them.
  const legacyA = { pp_abandoned: { total: 9 } };
  const legacyB = { pp_abandoned: { total: 4 } };
  const legacyMerged = mergeCounters(legacyA, legacyB);
  assert.equal(legacyMerged.pp_abandoned?.byRoundCount, undefined);
  assert.equal(legacyMerged.pp_abandoned?.byRoundIndex, undefined);
  assert.equal(legacyMerged.pp_abandoned?.total, 13);

  const mixed = mergeCounters(legacyA, day3);
  assert.deepEqual(mixed.pp_abandoned?.byRoundCount, { "10": 1 });
  assert.equal(mixed.pp_abandoned?.total, 10);
});

test("adding the pass-play breakouts leaves every unrelated counter byte-identical", () => {
  const before = incrementEvent({}, "game_started", { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, "web", "0.50.0", "abc1234");
  const after = incrementEvent(before, "pp_game_started", { playerCount: 2, roundCount: 10, difficulty: "mixed" }, "android", "0.50.0", "abc1234");
  assert.deepEqual(after.game_started, before.game_started);
  // And the pass-play event keeps the dimensions every event gets.
  assert.deepEqual(after.pp_game_started?.byPlatform, { android: 1 });
  assert.deepEqual(after.pp_game_started?.byAppVersion, { "0.50.0": 1 });
  assert.equal(after.pp_game_started?.byAppBuild, undefined);
});

test("byInstallAge survives the merge a range report is built from", () => {
  // The twin of the byReason merge test above, and the reason it exists: byInstallAge
  // was added to EventCounters and to incrementEvent but NOT to mergeCounters' explicit
  // field list, so every report silently dropped it while the day buckets held it
  // correctly. Ingestion tests alone could not catch that - only this path does.
  const day1 = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "bba5d10");
  const day2 = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "bba5d10");
  const day3 = incrementEvent({}, "first_open", { installAge: "d7_30" }, "android", "0.50.0", "bba5d10");
  const merged = mergeCounters(mergeCounters(day1, day2), day3);
  assert.deepEqual(merged.first_open?.byInstallAge, { h0_24: 2, d7_30: 1 });
  assert.equal(merged.first_open?.total, 3);

  // A day bucket written before byInstallAge existed has no such map; merging two of
  // them must leave it absent rather than inventing an empty object.
  const legacyA = { first_open: { total: 4 } };
  const legacyB = { first_open: { total: 1 } };
  const legacyMerged = mergeCounters(legacyA, legacyB);
  assert.equal(legacyMerged.first_open?.byInstallAge, undefined);
  assert.equal(legacyMerged.first_open?.total, 5);

  // And merging history with a new day keeps only the new day's buckets, rather than
  // back-attributing installs whose age was never stored.
  const mixed = mergeCounters(legacyA, day3);
  assert.deepEqual(mixed.first_open?.byInstallAge, { d7_30: 1 });
  assert.equal(mixed.first_open?.total, 5);

  // install_attributed has no params at all, so a merge can never give it the map.
  const attributed = mergeCounters(
    incrementEvent({}, "install_attributed", {}, "android", "0.50.0", "bba5d10"),
    incrementEvent({}, "install_attributed", {}, "android", "0.50.0", "bba5d10"),
  );
  assert.equal(attributed.install_attributed?.byInstallAge, undefined);
  assert.equal(attributed.install_attributed?.total, 2);
});
