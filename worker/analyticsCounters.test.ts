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

// --- Rewarded ads: coarse country diagnostics --------------------------------
//
// Country is derived SERVER-SIDE (index.ts reads request.cf.country and passes the
// normalized code in); the client never sends it. These pin the normalization, the
// four events that get it, the country x reason pair on failures only, and the two
// distinct fallbacks - ZZ means "country unknown", OTHER means "too many keys".

const OFFER_EVENTS = ["reward_offer_shown", "reward_bonus_offer_shown"] as const;
const PLACEMENT = { placement: "shape_challenge_double_reward" } as const;

test("a real country code is kept as-is on every rewarded event that declares it", () => {
  const unavailable = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  const loaded = incrementEvent({}, "rewarded_ad_loaded", { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, "DE");
  assert.deepEqual(unavailable.rewarded_ad_unavailable?.byCountry, { IR: 1 });
  assert.deepEqual(loaded.rewarded_ad_loaded?.byCountry, { DE: 1 });
  for (const name of OFFER_EVENTS) {
    const offer = incrementEvent({}, name, { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, "IL");
    assert.deepEqual(offer[name]?.byCountry, { IL: 1 }, name + " is a denominator");
  }
});

test("missing, Cloudflare-unknown and malformed codes all become ZZ", () => {
  for (const raw of [undefined, null, "", "XX", "T1", "iran", "USA", "I", "12", 5, {}, "  "]) {
    const c = incrementEvent({}, "rewarded_ad_loaded", { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, raw as string);
    assert.deepEqual(c.rewarded_ad_loaded?.byCountry, { ZZ: 1 }, JSON.stringify(raw) + " is unknown");
  }
  // Lowercase is a real code in the wrong case, not junk.
  const lower = incrementEvent({}, "rewarded_ad_loaded", { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, "ir");
  assert.deepEqual(lower.rewarded_ad_loaded?.byCountry, { IR: 1 });
});

test("byCountryReason pairs the two closed sets, on failures only", () => {
  let c = {};
  const pairs = [["IR", "timeout"], ["IR", "sdk_error"], ["IR", "timeout"], ["DE", "no_fill"]] as const;
  for (const [country, reason] of pairs) {
    c = incrementEvent(c, "rewarded_ad_unavailable", { ...PLACEMENT, reason }, "android", "0.50.0", "abc1234", undefined, country);
  }
  const e = (c as Record<string, { byCountryReason?: Record<string, number>; byCountry?: Record<string, number>; total: number }>).rewarded_ad_unavailable;
  assert.deepEqual(e.byCountryReason, { "IR|timeout": 2, "IR|sdk_error": 1, "DE|no_fill": 1 });
  assert.deepEqual(e.byCountry, { IR: 3, DE: 1 });
  assert.equal(e.total, 4);

  // A reason outside AD_FAILURE_REASONS opens no combined key; the country still counts.
  const bad = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "kaboom" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.equal(bad.rewarded_ad_unavailable?.byCountryReason, undefined);
  assert.deepEqual(bad.rewarded_ad_unavailable?.byCountry, { IR: 1 });

  // Events with no reason never get the pair.
  const loaded = incrementEvent({}, "rewarded_ad_loaded", { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.equal(loaded.rewarded_ad_loaded?.byCountryReason, undefined);
});

test("ZZ and OTHER stay distinct - unknown country vs cardinality overflow", () => {
  let c = {};
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let made = 0;
  for (const a of letters) {
    for (const b of letters) {
      if (made >= 160) break;
      c = incrementEvent(c, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, a + b);
      made += 1;
    }
    if (made >= 160) break;
  }
  const map = (c as Record<string, { byCountryReason?: Record<string, number> }>).rewarded_ad_unavailable.byCountryReason!;
  assert.equal(Object.keys(map).length, 151, "150 real keys plus the overflow key");
  assert.ok(map.OTHER >= 1, "everything past the cap lands in OTHER");
  assert.equal(map.ZZ, undefined, "overflow is never attributed to the unknown-country key");

  // An unknown country still reaches ZZ|reason, not OTHER.
  const unknown = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "sdk_error" }, "android", "0.50.0", "abc1234", undefined, "XX");
  assert.deepEqual(unknown.rewarded_ad_unavailable?.byCountryReason, { "ZZ|sdk_error": 1 });
});

test("unrelated events get no country breakdowns", () => {
  const names = ["app_open", "game_started", "pp_game_started", "rewarded_ad_requested", "reward_skipped"] as const;
  for (const name of names) {
    const c = incrementEvent({}, name, { gameType: "shapeChallenge", placement: "shape_challenge_double_reward", playerCount: 2, roundCount: 10, difficulty: "mixed" }, "android", "0.50.0", "abc1234", undefined, "IR");
    assert.equal(c[name]?.byCountry, undefined, name + " gets no byCountry");
    assert.equal(c[name]?.byCountryReason, undefined, name + " gets no byCountryReason");
  }
});

test("country maps survive the merge a range report is built from", () => {
  const day1 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  const day2 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  const day3 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "sdk_error" }, "android", "0.50.0", "abc1234", undefined, "DE");
  const merged = mergeCounters(mergeCounters(day1, day2), day3);
  assert.deepEqual(merged.rewarded_ad_unavailable?.byCountry, { IR: 2, DE: 1 });
  assert.deepEqual(merged.rewarded_ad_unavailable?.byCountryReason, { "IR|timeout": 2, "DE|sdk_error": 1 });
  assert.equal(merged.rewarded_ad_unavailable?.total, 3);

  // A bucket written before these fields existed stays without them.
  const legacyA = { rewarded_ad_unavailable: { total: 7 } };
  const legacyMerged = mergeCounters(legacyA, { rewarded_ad_unavailable: { total: 2 } });
  assert.equal(legacyMerged.rewarded_ad_unavailable?.byCountry, undefined);
  assert.equal(legacyMerged.rewarded_ad_unavailable?.byCountryReason, undefined);
  assert.equal(legacyMerged.rewarded_ad_unavailable?.total, 9);

  const mixed = mergeCounters(legacyA, day3);
  assert.deepEqual(mixed.rewarded_ad_unavailable?.byCountry, { DE: 1 });
  assert.equal(mixed.rewarded_ad_unavailable?.total, 8);
});

test("adding country leaves byReason, byInstallAge and the pass-play maps untouched", () => {
  const withCountry = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR").rewarded_ad_unavailable!;
  const without = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234").rewarded_ad_unavailable!;
  assert.deepEqual(withCountry.byReason, without.byReason, "byReason is unchanged");
  assert.deepEqual(withCountry.byPlatform, without.byPlatform);
  assert.deepEqual(withCountry.byAppVersion, without.byAppVersion);
  assert.equal(withCountry.total, without.total);
  // No country argument at all still records the event, under ZZ.
  assert.deepEqual(without.byCountry, { ZZ: 1 });

  // first_open gained byCountry for acquisition measurement; byInstallAge, which it
  // already had, must be untouched by that.
  const firstOpen = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(firstOpen.first_open?.byInstallAge, { h0_24: 1 }, "byInstallAge is unchanged");
  assert.deepEqual(firstOpen.first_open?.byCountry, { IR: 1 });

  const quit = incrementEvent({}, "pp_abandoned", { roundIndex: 2, playerCount: 2, roundCount: 10 }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(quit.pp_abandoned?.byRoundCount, { "10": 1 });
  assert.deepEqual(quit.pp_abandoned?.byRoundIndex, { "2": 1 });
  assert.equal(quit.pp_abandoned?.byCountry, undefined);
});

// --- Rewarded ads: country crossed with app version --------------------------
//
// byCountry and byAppVersion are separate maps, so neither can say whether the
// Iranian failures come from 0.48.4, from 0.50.0, or from both. These pin the
// crossed keys, and the three fallbacks that must never be conflated: ZZ is an
// unknown COUNTRY, "unknown" is an unknown VERSION, OTHER is cap overflow.

test("country and app version are crossed on the four rewarded events", () => {
  const ir50 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(ir50.rewarded_ad_unavailable?.byCountryAppVersion, { "IR|0.50.0": 1 });
  assert.deepEqual(ir50.rewarded_ad_unavailable?.byCountryAppVersionReason, { "IR|0.50.0|timeout": 1 });

  const ir48 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "sdk_error" }, "android", "0.48.4", "abc1234", undefined, "IR");
  assert.deepEqual(ir48.rewarded_ad_unavailable?.byCountryAppVersion, { "IR|0.48.4": 1 });
  assert.deepEqual(ir48.rewarded_ad_unavailable?.byCountryAppVersionReason, { "IR|0.48.4|sdk_error": 1 });

  const de50 = incrementEvent({}, "rewarded_ad_loaded", { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, "DE");
  assert.deepEqual(de50.rewarded_ad_loaded?.byCountryAppVersion, { "DE|0.50.0": 1 });
  assert.equal(de50.rewarded_ad_loaded?.byCountryAppVersionReason, undefined, "loaded carries no reason");

  for (const name of OFFER_EVENTS) {
    const offer = incrementEvent({}, name, { ...PLACEMENT }, "android", "0.50.0", "abc1234", undefined, "DE");
    assert.deepEqual(offer[name]?.byCountryAppVersion, { "DE|0.50.0": 1 }, name + " is a denominator");
    assert.equal(offer[name]?.byCountryAppVersionReason, undefined);
  }
});

// --- Acquisition country ------------------------------------------------------
//
// Where new installs arrive from decides whether ad monetization is available for
// them at all. byCountry on these two events is the only thing that can answer it -
// the ad and multiplayer breakouts measure people who already play.
//
// The reading is narrow and these tests are written to keep it narrow: NETWORK
// country of the request that carried the event, nothing more.

test("first_open and install_attributed record byCountry", () => {
  const ir = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(ir.first_open?.byCountry, { IR: 1 });
  assert.equal(ir.first_open?.total, 1);

  const attributed = incrementEvent({}, "install_attributed", {}, "android", "0.50.0", "abc1234", { source: "youtube" }, "DE");
  assert.deepEqual(attributed.install_attributed?.byCountry, { DE: 1 });
  assert.equal(attributed.install_attributed?.total, 1);
  // The attribution dimensions it already had are untouched by the new map.
  assert.deepEqual(attributed.install_attributed?.bySource, { youtube: 1 });
});

test("acquisition countries accumulate and survive mergeCounters", () => {
  const days = [
    incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "IR"),
    incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "IR"),
    incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "AZ"),
    incrementEvent({}, "install_attributed", {}, "android", "0.50.0", "abc1234", undefined, "PL"),
  ];
  const merged = days.reduce((a, b) => mergeCounters(a, b));
  assert.deepEqual(merged.first_open?.byCountry, { IR: 2, AZ: 1 });
  assert.equal(merged.first_open?.total, 3, "the global total is the sum of the country map");
  assert.deepEqual(merged.install_attributed?.byCountry, { PL: 1 });

  // Forward-only: a bucket counted before this shipped has no country and must not
  // invent one by being merged with a bucket that does.
  const legacy = { first_open: { total: 40 } };
  const mixed = mergeCounters(legacy, merged);
  assert.deepEqual(mixed.first_open?.byCountry, { IR: 2, AZ: 1 }, "history is not backfilled");
  assert.equal(mixed.first_open?.total, 43, "but it still counts toward the total");
  assert.equal(mergeCounters(legacy, { first_open: { total: 2 } }).first_open?.byCountry, undefined);
});

test("a missing or malformed acquisition country falls back to ZZ, not to nothing", () => {
  for (const [country, expected] of [
    [undefined, "ZZ"],
    ["XX", "ZZ"],
    ["T1", "ZZ"],
    ["", "ZZ"],
    ["nonsense", "ZZ"],
    ["il", "IL"],
  ] as const) {
    const c = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, country);
    assert.deepEqual(c.first_open?.byCountry, { [expected]: 1 }, `${String(country)} -> ${expected}`);
    assert.equal(c.first_open?.total, 1, "an unknown country still counts the event");
  }
});

test("the acquisition pair gets byCountry and NOT the crossed country x version map", () => {
  // These two sets were once aliases, so adding an event to one silently added it to
  // the other. This is the regression test for that, not a style assertion.
  for (const name of ["first_open", "install_attributed"] as const) {
    const c = incrementEvent({}, name, name === "first_open" ? { installAge: "h0_24" } : {}, "android", "0.50.0", "abc1234", undefined, "IR");
    assert.deepEqual(c[name]?.byCountry, { IR: 1 }, `${name} has byCountry`);
    assert.equal(c[name]?.byCountryAppVersion, undefined, `${name} must NOT gain byCountryAppVersion`);
    assert.equal(c[name]?.byCountryReason, undefined);
    assert.equal(c[name]?.byCountryAppVersionReason, undefined);
  }
});

test("the existing breakouts are unaffected by the acquisition pair joining", () => {
  // Rewarded still crosses; an event in neither set still gains no country map.
  const rewarded = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(rewarded.rewarded_ad_unavailable?.byCountry, { IR: 1 });
  assert.deepEqual(rewarded.rewarded_ad_unavailable?.byCountryAppVersion, { "IR|0.50.0": 1 });
  assert.deepEqual(rewarded.rewarded_ad_unavailable?.byCountryAppVersionReason, { "IR|0.50.0|timeout": 1 });

  const room = incrementEvent({}, "mp_room_created", {}, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(room.mp_room_created?.byCountry, { IR: 1 });
  assert.equal(room.mp_room_created?.byCountryAppVersion, undefined);

  const started = incrementEvent({}, "game_started", { gameType: "shapeChallenge" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.equal(started.game_started?.byCountry, undefined, "an event outside the set stays outside it");
});

test("ZZ, unknown and OTHER mean three different things", () => {
  // Unknown country, known version.
  const noCountry = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "XX");
  assert.deepEqual(noCountry.rewarded_ad_unavailable?.byCountryAppVersion, { "ZZ|0.50.0": 1 });

  // Known country, unknown version - a client that predates the appVersion field.
  const noVersion = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", undefined, undefined, undefined, "IR");
  assert.deepEqual(noVersion.rewarded_ad_unavailable?.byCountryAppVersion, { "IR|unknown": 1 });
  assert.deepEqual(noVersion.rewarded_ad_unavailable?.byCountryAppVersionReason, { "IR|unknown|timeout": 1 });

  // Neither.
  const neither = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "no_fill" }, "android", undefined, undefined, undefined, "T1");
  assert.deepEqual(neither.rewarded_ad_unavailable?.byCountryAppVersion, { "ZZ|unknown": 1 });
  assert.deepEqual(neither.rewarded_ad_unavailable?.byCountryAppVersionReason, { "ZZ|unknown|no_fill": 1 });
});

test("every reason crosses cleanly, and an invalid one opens no crossed key", () => {
  let c = {};
  for (const reason of ["timeout", "sdk_error", "no_fill", "timeout"] as const) {
    c = incrementEvent(c, "rewarded_ad_unavailable", { ...PLACEMENT, reason }, "android", "0.50.0", "abc1234", undefined, "IR");
  }
  const e = (c as Record<string, { byCountryAppVersionReason?: Record<string, number>; byCountryAppVersion?: Record<string, number> }>).rewarded_ad_unavailable;
  assert.deepEqual(e.byCountryAppVersionReason, { "IR|0.50.0|timeout": 2, "IR|0.50.0|sdk_error": 1, "IR|0.50.0|no_fill": 1 });
  assert.deepEqual(e.byCountryAppVersion, { "IR|0.50.0": 4 }, "the pair counts every event regardless of reason");

  const bad = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "kaboom" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.equal(bad.rewarded_ad_unavailable?.byCountryAppVersionReason, undefined);
  assert.deepEqual(bad.rewarded_ad_unavailable?.byCountryAppVersion, { "IR|0.50.0": 1 }, "the event still counts");
});

test("appVersion is only format-guarded, so the crossed maps are bounded by their cap", () => {
  // 160 distinct synthetic versions against one country - the cap, not the input, is
  // what stops the map growing.
  let c = {};
  for (let i = 0; i < 160; i += 1) {
    c = incrementEvent(c, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", `1.${i % 100}.${i}`, "abc1234", undefined, "IR");
  }
  const map = (c as Record<string, { byCountryAppVersion?: Record<string, number> }>).rewarded_ad_unavailable.byCountryAppVersion!;
  assert.equal(Object.keys(map).length, 151, "150 real keys plus OTHER");
  assert.ok(map.OTHER >= 1);
  assert.equal(map.ZZ, undefined, "overflow is not the unknown-country key");
  assert.equal(map.unknown, undefined, "overflow is not the unknown-version key");
});

test("unrelated events get no crossed breakdowns", () => {
  const names = ["app_open", "game_started", "pp_abandoned", "rewarded_ad_requested", "first_open"] as const;
  for (const name of names) {
    const c = incrementEvent({}, name, { gameType: "shapeChallenge", placement: "shape_challenge_double_reward", roundIndex: 1, playerCount: 2, roundCount: 10, installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "IR");
    assert.equal(c[name]?.byCountryAppVersion, undefined, name + " gets no byCountryAppVersion");
    assert.equal(c[name]?.byCountryAppVersionReason, undefined, name + " gets no byCountryAppVersionReason");
  }
});

test("the crossed maps survive the merge a range report is built from", () => {
  const day1 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  const day2 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR");
  const day3 = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "sdk_error" }, "android", "0.48.4", "abc1234", undefined, "DE");
  const merged = mergeCounters(mergeCounters(day1, day2), day3);
  assert.deepEqual(merged.rewarded_ad_unavailable?.byCountryAppVersion, { "IR|0.50.0": 2, "DE|0.48.4": 1 });
  assert.deepEqual(merged.rewarded_ad_unavailable?.byCountryAppVersionReason, { "IR|0.50.0|timeout": 2, "DE|0.48.4|sdk_error": 1 });

  // Buckets written before these fields existed stay without them.
  const legacyA = { rewarded_ad_unavailable: { total: 5 } };
  const legacyMerged = mergeCounters(legacyA, { rewarded_ad_unavailable: { total: 1 } });
  assert.equal(legacyMerged.rewarded_ad_unavailable?.byCountryAppVersion, undefined);
  assert.equal(legacyMerged.rewarded_ad_unavailable?.byCountryAppVersionReason, undefined);
  assert.equal(legacyMerged.rewarded_ad_unavailable?.total, 6);

  const mixed = mergeCounters(legacyA, day3);
  assert.deepEqual(mixed.rewarded_ad_unavailable?.byCountryAppVersion, { "DE|0.48.4": 1 });
  assert.equal(mixed.rewarded_ad_unavailable?.total, 6);
});

test("crossing changes nothing about the dimensions that already existed", () => {
  const e = incrementEvent({}, "rewarded_ad_unavailable", { ...PLACEMENT, reason: "timeout" }, "android", "0.50.0", "abc1234", undefined, "IR").rewarded_ad_unavailable!;
  assert.deepEqual(e.byCountry, { IR: 1 }, "byCountry unchanged");
  assert.deepEqual(e.byCountryReason, { "IR|timeout": 1 }, "byCountryReason unchanged");
  assert.deepEqual(e.byAppVersion, { "0.50.0": 1 }, "byAppVersion unchanged");
  assert.deepEqual(e.byReason, { timeout: 1 }, "byReason unchanged");
  assert.deepEqual(e.byPlatform, { android: 1 });
  assert.equal(e.total, 1);

  const firstOpen = incrementEvent({}, "first_open", { installAge: "h0_24" }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(firstOpen.first_open?.byInstallAge, { h0_24: 1 }, "byInstallAge unchanged");

  const quit = incrementEvent({}, "pp_abandoned", { roundIndex: 2, playerCount: 2, roundCount: 10 }, "android", "0.50.0", "abc1234", undefined, "IR");
  assert.deepEqual(quit.pp_abandoned?.byRoundCount, { "10": 1 }, "pass-play unchanged");
  assert.deepEqual(quit.pp_abandoned?.byRoundIndex, { "2": 1 });
});
