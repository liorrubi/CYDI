import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyUsageBucket,
  isAudienceFilter,
  mergeUsageBuckets,
  normalizeAnalyticsAudience,
  normalizeAnalyticsId,
  recordUsageIds,
  summarizeUsage,
  usageSegmentKey,
  MAX_INSTALLATION_IDS_PER_DAY,
  type UsageBucket,
} from "./analyticsUsage.ts";

const noGames = { gamesStarted: 0, gamesCompleted: 0, gamesStartedByPlatform: {}, gamesCompletedByPlatform: {} };

// --- Ingest envelope: every field is optional, and an old client is never internal ---

test("audience defaults to external for clients that send no isInternal flag", () => {
  assert.equal(normalizeAnalyticsAudience(undefined), "external");
  assert.equal(normalizeAnalyticsAudience(null), "external");
  assert.equal(normalizeAnalyticsAudience(false), "external");
  // Only a real boolean true counts - a truthy string from a hand-crafted body does not.
  assert.equal(normalizeAnalyticsAudience("true"), "external");
  assert.equal(normalizeAnalyticsAudience(1), "external");
  assert.equal(normalizeAnalyticsAudience(true), "internal");
});

test("ids from old clients or hostile bodies are dropped, not stored", () => {
  assert.equal(normalizeAnalyticsId(undefined), null);
  assert.equal(normalizeAnalyticsId(null), null);
  assert.equal(normalizeAnalyticsId(""), null);
  assert.equal(normalizeAnalyticsId(123), null);
  assert.equal(normalizeAnalyticsId("Z".repeat(12)), null, "non-hex must be rejected");
  assert.equal(normalizeAnalyticsId("a".repeat(64)), null, "over-long values must be rejected");
  assert.equal(normalizeAnalyticsId("user@example.com"), null, "free text must never be storable here");
  assert.equal(normalizeAnalyticsId("a1b2c3d4e5f6"), "a1b2c3d4e5f6");
});

test("audience filter accepts exactly external/internal/all", () => {
  assert.equal(isAudienceFilter("external"), true);
  assert.equal(isAudienceFilter("internal"), true);
  assert.equal(isAudienceFilter("all"), true);
  assert.equal(isAudienceFilter("qa"), false);
  assert.equal(isAudienceFilter(undefined), false);
});

// --- Recording ids into a day bucket ---

test("an id is stored once per day, and a repeat event returns the same object (no storage write)", () => {
  const first = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "111111111111");
  assert.deepEqual(first.segments[usageSegmentKey("external", "web")], {
    installations: ["aaaaaaaaaaaa"],
    sessions: ["111111111111"],
  });

  const repeat = recordUsageIds(first, "external", "web", "aaaaaaaaaaaa", "111111111111");
  assert.equal(repeat, first, "an already-seen installation+session must not rewrite the bucket");

  const secondSession = recordUsageIds(first, "external", "web", "aaaaaaaaaaaa", "222222222222");
  assert.deepEqual(secondSession.segments[usageSegmentKey("external", "web")].installations, ["aaaaaaaaaaaa"]);
  assert.deepEqual(secondSession.segments[usageSegmentKey("external", "web")].sessions, ["111111111111", "222222222222"]);
});

test("events with no ids at all are recorded without touching the usage bucket", () => {
  const bucket = emptyUsageBucket();
  assert.equal(recordUsageIds(bucket, "external", "android", null, null), bucket);
});

test("the same id on two platforms or two audiences lands in separate segments", () => {
  let bucket = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "111111111111");
  bucket = recordUsageIds(bucket, "external", "android", "bbbbbbbbbbbb", "222222222222");
  bucket = recordUsageIds(bucket, "internal", "android", "cccccccccccc", "333333333333");
  assert.deepEqual(Object.keys(bucket.segments).sort(), ["external|android", "external|web", "internal|android"]);
});

test("the per-day id cap stops growth and marks the day truncated", () => {
  let bucket: UsageBucket = emptyUsageBucket();
  for (let i = 0; i < MAX_INSTALLATION_IDS_PER_DAY; i++) {
    bucket = recordUsageIds(bucket, "external", "web", i.toString(16).padStart(12, "0"), null);
  }
  assert.equal(bucket.truncated, undefined);
  const overflowed = recordUsageIds(bucket, "external", "web", "ffffffffffff", null);
  assert.equal(overflowed.truncated, true);
  assert.equal(overflowed.segments["external|web"].installations.length, MAX_INSTALLATION_IDS_PER_DAY);
  // Still capped, and no further rewrite once the flag is already set.
  assert.equal(recordUsageIds(overflowed, "external", "web", "eeeeeeeeeeee", null), overflowed);
});

// --- Merging days: a returning installation is one installation, not one per day ---

test("merging days unions ids instead of summing them", () => {
  const monday = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "111111111111");
  const tuesday = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "222222222222");
  const merged = mergeUsageBuckets(monday, tuesday);
  const summary = summarizeUsage(merged, "external", noGames);
  assert.equal(summary.installations, 1, "same installation on two days is one installation");
  assert.equal(summary.sessions, 2, "but each day's session is its own session");
});

test("truncation anywhere in the range is carried into the summary", () => {
  const clean = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", null);
  const truncated: UsageBucket = { segments: {}, truncated: true };
  assert.equal(summarizeUsage(mergeUsageBuckets(clean, truncated), "external", noGames).truncated, true);
  assert.equal(summarizeUsage(clean, "external", noGames).truncated, false);
});

// --- Summaries: external vs internal, platform split, per-installation/session rates ---

test("internal activity is excluded from the external summary and reported on its own", () => {
  let bucket = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "111111111111");
  bucket = recordUsageIds(bucket, "internal", "android", "cccccccccccc", "333333333333");

  const external = summarizeUsage(bucket, "external", {
    gamesStarted: 10,
    gamesCompleted: 8,
    gamesStartedByPlatform: { web: 10 },
    gamesCompletedByPlatform: { web: 8 },
  });
  assert.equal(external.installations, 1);
  assert.equal(external.sessions, 1);
  assert.equal(external.byPlatform.android, undefined, "no internal-only platform may appear in the external summary");

  const internal = summarizeUsage(bucket, "internal", {
    gamesStarted: 40,
    gamesCompleted: 40,
    gamesStartedByPlatform: { android: 40 },
    gamesCompletedByPlatform: { android: 40 },
  });
  assert.equal(internal.installations, 1);
  assert.equal(internal.byPlatform.android.gamesStarted, 40);
  assert.equal(internal.byPlatform.web, undefined);
});

test("per-installation and per-session rates, overall and per platform", () => {
  let bucket = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "111111111111");
  bucket = recordUsageIds(bucket, "external", "web", "bbbbbbbbbbbb", "222222222222");
  bucket = recordUsageIds(bucket, "external", "android", "cccccccccccc", "333333333333");

  const summary = summarizeUsage(bucket, "external", {
    gamesStarted: 30,
    gamesCompleted: 15,
    gamesStartedByPlatform: { web: 20, android: 10 },
    gamesCompletedByPlatform: { web: 12, android: 3 },
  });

  assert.equal(summary.installations, 3);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.gamesStartedPerInstallation, 10);
  assert.equal(summary.gamesCompletedPerSession, 5);
  assert.equal(summary.byPlatform.web.installations, 2);
  assert.equal(summary.byPlatform.web.gamesStartedPerInstallation, 10);
  assert.equal(summary.byPlatform.android.installations, 1);
  assert.equal(summary.byPlatform.android.gamesCompletedPerInstallation, 3);
});

test("audience=all unions both audiences, and is the only view that mixes them", () => {
  let bucket = recordUsageIds(emptyUsageBucket(), "external", "web", "aaaaaaaaaaaa", "111111111111");
  bucket = recordUsageIds(bucket, "internal", "web", "cccccccccccc", "333333333333");
  const all = summarizeUsage(bucket, "all", noGames);
  assert.equal(all.installations, 2);
  assert.equal(summarizeUsage(bucket, "external", noGames).installations, 1);
});

test("rates are null (not 0) when there is nothing to divide by - the historical-data case", () => {
  // Days recorded before this feature have game counts but no ids at all.
  const summary = summarizeUsage(emptyUsageBucket(), "external", {
    gamesStarted: 100,
    gamesCompleted: 90,
    gamesStartedByPlatform: { web: 100 },
    gamesCompletedByPlatform: { web: 90 },
  });
  assert.equal(summary.installations, 0);
  assert.equal(summary.gamesStartedPerInstallation, null);
  assert.equal(summary.gamesCompletedPerSession, null);
  assert.equal(summary.gamesStarted, 100, "the counters themselves are still reported");
});
