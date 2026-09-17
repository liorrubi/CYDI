// The counting half of attribution: what ingestion stores, what merging preserves,
// and what the report can therefore answer. The landing decision is
// src/services/analyticsAttribution.test.ts.
//
// The point most of these tests defend is backward compatibility: attribution is an
// OPTIONAL envelope field, so every event an already-shipped build sends must keep
// being counted exactly as it is today, and every day bucket already in storage must
// keep reading exactly as it does today.
import test from "node:test";
import assert from "node:assert/strict";

import { incrementEvent, mergeCounters } from "./analyticsDO.ts";
import { ATTRIBUTION_OTHER, ATTRIBUTION_UNKNOWN, type Attribution } from "../src/services/analyticsAttribution.ts";
import {
  emptyUsageBucket,
  recordUsageIds,
  summarizeUsage,
  type UsageBucket,
  type UsageGameTotals,
} from "../src/services/analyticsUsage.ts";

function attribution(overrides: Partial<Attribution> = {}): Attribution {
  return {
    source: "youtube",
    medium: "shorts",
    campaign: "cydi_shorts",
    content: "N4H7VTj59A0",
    term: ATTRIBUTION_UNKNOWN,
    ...overrides,
  };
}

const noGames: UsageGameTotals = {
  gamesStarted: 0,
  gamesCompleted: 0,
  gamesStartedByPlatform: {},
  gamesCompletedByPlatform: {},
};

// --- Ingestion ---

test("a breakout event records the visit's source, campaign and creative", () => {
  const counters = incrementEvent({}, "app_open", {}, "web", "0.40.0", "abc1234", attribution());
  assert.deepEqual(counters.app_open?.bySource, { youtube: 1 });
  assert.deepEqual(counters.app_open?.byCampaign, { cydi_shorts: 1 });
  assert.deepEqual(counters.app_open?.byUtmContent, { N4H7VTj59A0: 1 });
  // The pre-existing dimensions are untouched.
  assert.equal(counters.app_open?.total, 1);
  assert.deepEqual(counters.app_open?.byPlatform, { web: 1 });
  assert.deepEqual(counters.app_open?.byAppBuild, { abc1234: 1 });
});

test("the game funnel is attributed, so games started/completed can be read per campaign", () => {
  let counters = incrementEvent({}, "game_started", { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, "web", "0.40.0", "abc1234", attribution());
  counters = incrementEvent(counters, "game_completed", { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, "web", "0.40.0", "abc1234", attribution());
  assert.deepEqual(counters.game_started?.bySource, { youtube: 1 });
  assert.deepEqual(counters.game_completed?.bySource, { youtube: 1 });
  // The funnel's own breakdowns still work alongside the new ones.
  assert.deepEqual(counters.game_started?.byContentKey, { circle: 1 });
});

test("events outside the breakout list carry no attribution maps, keeping storage bounded", () => {
  const counters = incrementEvent({}, "shape_completed", { starRating: 3, passed: true }, "web", "0.40.0", "abc1234", attribution());
  assert.equal(counters.shape_completed?.bySource, undefined);
  assert.equal(counters.shape_completed?.byCampaign, undefined);
  // Its own existing fields are unaffected.
  assert.equal(counters.shape_completed?.sumStarRating, 3);
});

test("an event from a build that predates attribution is counted exactly as before", () => {
  const counters = incrementEvent({}, "app_open", {}, "web", "0.40.0", "abc1234");
  assert.equal(counters.app_open?.total, 1);
  // Absent, NOT {"unknown": 1} - history is never attributed to a source it never had.
  assert.equal(counters.app_open?.bySource, undefined);
  assert.equal(counters.app_open?.byCampaign, undefined);
  assert.equal(counters.app_open?.byUtmContent, undefined);
});

test("an unattributable visit gets a real direct/unknown row rather than being dropped", () => {
  const counters = incrementEvent({}, "app_open", {}, "web", "0.40.0", "abc1234", {
    source: "direct",
    medium: "none",
    campaign: ATTRIBUTION_UNKNOWN,
    content: ATTRIBUTION_UNKNOWN,
    term: ATTRIBUTION_UNKNOWN,
  });
  assert.deepEqual(counters.app_open?.bySource, { direct: 1 });
  assert.deepEqual(counters.app_open?.byCampaign, { [ATTRIBUTION_UNKNOWN]: 1 });
});

test("a flood of forged campaigns cannot grow one day's counter map without bound", () => {
  let counters = {};
  for (let i = 0; i < 500; i++) {
    counters = incrementEvent(counters, "app_open", {}, "web", "0.40.0", "abc1234", attribution({ campaign: `spam-${i}` }));
  }
  const byCampaign = (counters as ReturnType<typeof incrementEvent>).app_open?.byCampaign ?? {};
  assert.ok(Object.keys(byCampaign).length <= 51, `got ${Object.keys(byCampaign).length} keys`);
  // Nothing is lost, it is only folded: every one of the 500 is still counted.
  assert.equal(
    Object.values(byCampaign).reduce((sum, n) => sum + n, 0),
    500,
  );
  assert.ok(byCampaign[ATTRIBUTION_OTHER] > 0, "overflow is counted under 'other'");
  // The source dimension is unaffected - all 500 were genuinely from youtube.
  assert.deepEqual((counters as ReturnType<typeof incrementEvent>).app_open?.bySource, { youtube: 500 });
});

// --- Merging (multi-day ranges, and the alltime bucket) ---

test("merging days sums the attribution maps and never invents one", () => {
  const monday = incrementEvent({}, "app_open", {}, "web", "0.40.0", "abc1234", attribution());
  const tuesday = incrementEvent({}, "app_open", {}, "web", "0.40.0", "abc1234", attribution({ source: "direct", campaign: ATTRIBUTION_UNKNOWN }));
  const merged = mergeCounters(monday, tuesday);
  assert.deepEqual(merged.app_open?.bySource, { youtube: 1, direct: 1 });

  // A legacy bucket merged with a legacy bucket stays legacy-shaped.
  const legacyA = incrementEvent({}, "app_open", {}, "web");
  const legacyB = incrementEvent({}, "app_open", {}, "web");
  assert.equal(mergeCounters(legacyA, legacyB).app_open?.bySource, undefined);

  // A legacy bucket merged with an attributed one keeps only the real attribution -
  // the legacy day's events are not backfilled into any source.
  const mixed = mergeCounters(legacyA, monday);
  assert.equal(mixed.app_open?.total, 2);
  assert.deepEqual(mixed.app_open?.bySource, { youtube: 1 });
});

// --- Usage: distinct installations and sessions per source ---

test("installations and sessions are counted per source", () => {
  let bucket: UsageBucket = emptyUsageBucket();
  bucket = recordUsageIds(bucket, "external", "web", "aaaaaaaaaaaa", "111111111111", attribution());
  bucket = recordUsageIds(bucket, "external", "web", "bbbbbbbbbbbb", "222222222222", attribution());
  bucket = recordUsageIds(bucket, "external", "web", "cccccccccccc", "333333333333", attribution({ source: "direct", campaign: ATTRIBUTION_UNKNOWN, content: ATTRIBUTION_UNKNOWN }));

  const summary = summarizeUsage(bucket, "external", noGames);
  assert.equal(summary.bySource.youtube.installations, 2);
  assert.equal(summary.bySource.youtube.sessions, 2);
  assert.equal(summary.bySource.direct.installations, 1);
  assert.equal(summary.byCampaign.cydi_shorts.installations, 2);
  assert.equal(summary.byContent["N4H7VTj59A0"].installations, 2);

  // The totals that existed before attribution are unchanged by the new split.
  assert.equal(summary.installations, 3);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.byPlatform.web.installations, 3);
});

test("a source row carries that source's games, so per-campaign conversion is readable", () => {
  let bucket: UsageBucket = emptyUsageBucket();
  bucket = recordUsageIds(bucket, "external", "web", "aaaaaaaaaaaa", "111111111111", attribution());
  const summary = summarizeUsage(bucket, "external", {
    gamesStarted: 4,
    gamesCompleted: 3,
    gamesStartedByPlatform: { web: 4 },
    gamesCompletedByPlatform: { web: 3 },
    gamesByAttribution: {
      source: { started: { youtube: 4 }, completed: { youtube: 3 } },
      campaign: { started: { cydi_shorts: 4 }, completed: { cydi_shorts: 3 } },
      content: { started: {}, completed: {} },
    },
  });
  assert.equal(summary.bySource.youtube.gamesStarted, 4);
  assert.equal(summary.bySource.youtube.gamesCompleted, 3);
  assert.equal(summary.bySource.youtube.gamesStartedPerSession, 4);
  assert.equal(summary.byCampaign.cydi_shorts.gamesCompleted, 3);
});

test("a bucket recorded before attribution reads as one unknown row, with its totals intact", () => {
  // Exactly what is in storage today: recordUsageIds called without an attribution.
  let bucket: UsageBucket = emptyUsageBucket();
  bucket = recordUsageIds(bucket, "external", "web", "aaaaaaaaaaaa", "111111111111");
  bucket = recordUsageIds(bucket, "external", "android", "bbbbbbbbbbbb", "222222222222");

  const summary = summarizeUsage(bucket, "external", noGames);
  assert.equal(summary.installations, 2);
  assert.equal(summary.byPlatform.web.installations, 1);
  assert.equal(summary.byPlatform.android.installations, 1);
  assert.deepEqual(Object.keys(summary.bySource), [ATTRIBUTION_UNKNOWN]);
  assert.equal(summary.bySource[ATTRIBUTION_UNKNOWN].installations, 2);
});

test("the internal audience keeps its own attribution rows, never mixing with real players", () => {
  let bucket: UsageBucket = emptyUsageBucket();
  bucket = recordUsageIds(bucket, "external", "web", "aaaaaaaaaaaa", "111111111111", attribution());
  bucket = recordUsageIds(bucket, "internal", "web", "cccccccccccc", "333333333333", attribution());
  assert.equal(summarizeUsage(bucket, "external", noGames).bySource.youtube.installations, 1);
  assert.equal(summarizeUsage(bucket, "internal", noGames).bySource.youtube.installations, 1);
  assert.equal(summarizeUsage(bucket, "all", noGames).bySource.youtube.installations, 2);
});

test("a flood of forged campaigns cannot grow one day's usage bucket without bound", () => {
  let bucket: UsageBucket = emptyUsageBucket();
  for (let i = 0; i < 500; i++) {
    bucket = recordUsageIds(bucket, "external", "web", i.toString(16).padStart(12, "0"), null, attribution({ campaign: `spam-${i}` }));
  }
  assert.ok(Object.keys(bucket.segments).length <= 65, `got ${Object.keys(bucket.segments).length} segments`);
  // The platform total is still exact - only the campaign breakdown degrades.
  assert.equal(summarizeUsage(bucket, "external", noGames).installations, 500);
});
