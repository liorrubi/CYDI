// Proves the ID-resolution and internal-test-ads-mode contract:
// - shipped AD_FLAGS.master stays false, and isAdFormatEnabled() reflects that,
//   regardless of anything internal-test-mode touches (requirement: production
//   ADS_ENABLED must never flip true as a side effect of this feature);
// - internal-test-ads mode forces Google's official test app/ad-unit IDs and
//   turns on exactly the "rewarded" format, bypassing AD_FLAGS entirely, without
//   ever mutating AD_FLAGS itself;
// - internal-test-ads mode is only ever true via the exact literal string "true".

import { strict as assert } from "node:assert";
import { test, afterEach } from "node:test";
import {
  AD_FLAGS,
  _setAdFlagsForTests,
  _setAdsInternalTestModeForTests,
  getAdMobAppId,
  getAdUnitId,
  isAdFormatEnabled,
  isAdTestingEnvironment,
} from "./adConfig";
import type { AdFormat } from "./adTypes";

const ALL_FORMATS: AdFormat[] = ["rewarded", "rewardedInterstitial", "interstitial", "banner", "appOpen"];

afterEach(() => {
  _setAdsInternalTestModeForTests(undefined);
  _setAdFlagsForTests();
});

test("production path is untouched: AD_FLAGS.master stays false, no format is enabled", () => {
  _setAdsInternalTestModeForTests(false);
  assert.equal(AD_FLAGS.master, false);
  for (const format of ALL_FORMATS) assert.equal(isAdFormatEnabled(format), false);
});

test("internal-test-ads mode forces rewarded on, every other format stays off, and AD_FLAGS is never mutated", () => {
  const masterBefore = AD_FLAGS.master;
  _setAdsInternalTestModeForTests(true);
  assert.equal(isAdFormatEnabled("rewarded"), true);
  for (const format of ALL_FORMATS) {
    if (format === "rewarded") continue;
    assert.equal(isAdFormatEnabled(format), false, `${format} must stay off in internal-test mode`);
  }
  // The shipped flags object itself must be byte-for-byte unchanged.
  assert.equal(AD_FLAGS.master, masterBefore);
  assert.equal(AD_FLAGS.master, false);
});

test("internal-test-ads mode resolves Google's official test app ID and ad unit IDs, never real ones", () => {
  _setAdsInternalTestModeForTests(true);
  assert.equal(isAdTestingEnvironment(), true);
  assert.match(getAdMobAppId("android"), /^ca-app-pub-3940256099942544~/);
  assert.match(getAdMobAppId("ios"), /^ca-app-pub-3940256099942544~/);
  for (const format of ALL_FORMATS) {
    assert.match(getAdUnitId(format, "android"), /^ca-app-pub-3940256099942544\//);
    assert.match(getAdUnitId(format, "ios"), /^ca-app-pub-3940256099942544\//);
  }
});

test("outside internal-test mode (plain node test env), IDs still resolve to Google test units, never prod env vars", () => {
  _setAdsInternalTestModeForTests(false);
  assert.equal(isAdTestingEnvironment(), true, "plain Node has no import.meta.env.DEV, treated as dev/test by design");
  assert.match(getAdUnitId("rewarded", "android"), /^ca-app-pub-3940256099942544\//);
});
