// The admin dashboard's derived numbers (public/admin/analytics-model.js). Every rate the
// page shows is defined there; these tests pin each denominator, the source-mixing rules
// and the report cache that keeps the dashboard from re-querying.
import test from "node:test";
import assert from "node:assert/strict";

const M = await import("../public/admin/analytics-model.js");

const c = (n: number, extra: Record<string, unknown> = {}) => ({ total: n, ...extra });

test("rewarded funnel: offers = x2 + bonus, starts/completions/skips/fails summed, rates over explicit denominators", () => {
  const report = {
    counts: {
      reward_offer_shown: c(300),
      reward_bonus_offer_shown: c(700),
      reward_ad_started: c(6),
      reward_bonus_ad_started: c(4),
      reward_ad_completed: c(3),
      reward_bonus_ad_completed: c(2),
      reward_skipped: c(900),
      reward_bonus_skipped: c(50),
      reward_ad_failed: c(1),
    },
    sources: { telemetryAeDates: ["2026-09-27"], telemetryDoDates: [] },
  };
  const f = M.rewardedFunnel(report, null);
  assert.equal(f.basis, "range");
  assert.deepEqual([f.all.offers, f.all.offersX2, f.all.offersBonus], [1000, 300, 700]);
  assert.deepEqual([f.all.starts, f.all.completions, f.all.skips, f.all.fails], [10, 5, 950, 1]);
  assert.equal(f.rates.startPerOffer, 10 / 1000);
  assert.equal(f.rates.completionPerStart, 5 / 10);
  assert.equal(f.rates.skipRate, 950 / 1000);
  assert.equal(f.availability, null, "availability needs the economy block");
});

test("rewarded funnel: a range mixing DO and AE dates computes its rates on the AE dates only", () => {
  const report = {
    counts: { reward_offer_shown: c(110), reward_ad_started: c(12) },
    sources: { telemetryAeDates: ["2026-09-26"], telemetryDoDates: ["2026-09-25"] },
    days: [
      { date: "2026-09-25", counts: { reward_offer_shown: c(10), reward_ad_started: c(10) } }, // 10% sample vs exact: meaningless ratio
      { date: "2026-09-26", counts: { reward_offer_shown: c(100), reward_ad_started: c(2) } },
    ],
  };
  const f = M.rewardedFunnel(report, null);
  assert.equal(f.basis, "ae-dates");
  assert.deepEqual(f.rateDates, ["2026-09-26"]);
  assert.equal(f.rates.startPerOffer, 2 / 100, "the sampled day would have given 12/110");
  assert.equal(f.all.offers, 110, "the range totals are still shown as they are");
});

test("rewarded availability comes from the economy block, with its own denominators", () => {
  const economy = { telemetryDates: ["2026-09-27"], telemetry: { rewardFunnel: { total: { offers: 1000, offersWithAd: 950, startsWithAd: 5, completionsWithAd: 1 } } } };
  const f = M.rewardedFunnel({ counts: {}, sources: { telemetryAeDates: [], telemetryDoDates: [] } }, economy);
  assert.equal(f.availability.availabilityRate, 950 / 1000);
  assert.equal(f.availability.startPerAvailableOffer, 5 / 950);
  assert.equal(f.availability.completionPerStartWithAd, 1 / 5);
});

test("rates never hide a zero denominator as 0%", () => {
  assert.equal(M.rate(0, 0), null);
  assert.equal(M.rewardedFunnel({ counts: {}, sources: { telemetryAeDates: [], telemetryDoDates: [] } }, null).rates.completionPerStart, null);
});

test("market groups: IR, AZ and the other policy countries are kept out of 'Ads markets'", () => {
  assert.equal(M.marketOf("DE"), "ads");
  assert.equal(M.marketOf("IR"), "IR");
  assert.equal(M.marketOf("AZ"), "AZ");
  assert.equal(M.marketOf("SY"), "policy");
  assert.equal(M.marketOf("ZZ"), "unknown");
  assert.deepEqual(M.byMarket({ DE: 5, US: 2, IR: 9, AZ: 3, CU: 1, ZZ: 4 }), { ads: 7, IR: 9, AZ: 3, policy: 1, unknown: 4 });
  assert.deepEqual(M.byMarketReason({ "IR|sdk_error": 5, "DE|timeout": 2, "FR|timeout": 1 }), { IR: { sdk_error: 5 }, ads: { timeout: 3 } });
});

test("rewarded delivery: load success = loaded / (loaded + unavailable) within each market", () => {
  const d = M.rewardedDelivery({
    rewarded_ad_loaded: c(12, { byCountry: { DE: 10, IR: 2 } }),
    rewarded_ad_unavailable: c(108, { byCountry: { DE: 10, IR: 98 }, byCountryReason: { "DE|no_fill": 10, "IR|sdk_error": 98 }, byReason: { no_fill: 10, sdk_error: 98 } }),
  });
  const de = d.rows.find((r: { market: string }) => r.market === "ads");
  const ir = d.rows.find((r: { market: string }) => r.market === "IR");
  assert.deepEqual([de.attempts, de.loadSuccess], [20, 0.5]);
  assert.deepEqual([ir.attempts, ir.loadSuccess], [100, 0.02]);
  assert.deepEqual(ir.reasons, { sdk_error: 98 });
  assert.equal(d.rows.some((r: { market: string }) => r.market === "AZ"), false, "markets without attempts are left out");
});

test("experiment arms: plus100 vs x3 from the multiplier funnel, other x2 placements apart", () => {
  const economy = { telemetry: { rewardFunnel: { byMultiplierRewardSize: {
    "x3|1_49": { offers: 100, offersWithAd: 90, startsWithAd: 9, completionsWithAd: 8, skips: 80 },
    "x3|50_99": { offers: 50, offersWithAd: 45, startsWithAd: 1, completionsWithAd: 1, skips: 40 },
    "plus100|1_49": { offers: 120, offersWithAd: 100, startsWithAd: 20, completionsWithAd: 15, skips: 90 },
    "x2|100_249": { offers: 10, offersWithAd: 10, startsWithAd: 1, completionsWithAd: 1, skips: 9 },
  } } } };
  const e = M.rewardedExperiment(economy);
  assert.deepEqual(e.arms.map((a: { arm: string }) => a.arm), ["x3", "plus100", "x2"]);
  const x3 = e.arms[0];
  assert.deepEqual([x3.offers, x3.offersWithAd, x3.startsWithAd], [150, 135, 10]);
  assert.equal(x3.startPerAvailableOffer, 10 / 135);
  assert.equal(e.arms[1].completionPerStart, 15 / 20);
  assert.equal(e.hasPlus100, true);
  assert.equal(M.rewardedExperiment(null), null);
});

test("interstitial: readiness excludes suppressed, show rate is over all treatment checkpoints, continuation per arm|outcome", () => {
  const f = M.interstitialFunnel({
    interstitial_checkpoint: c(120, { byArmOutcome: { "control|control": 60, "treatment|not_ready": 30, "treatment|shown": 20, "treatment|show_failed": 2, "treatment|suppressed": 8 }, byCountry: { DE: 50, IR: 10, AZ: 60 }, byCadence: { "7": 120 } }),
    interstitial_continuation: c(100, { byArmOutcome: { "control|control": 58, "treatment|shown": 15, "treatment|not_ready": 27 } }),
    interstitial_dismissed: c(18),
    interstitial_load_failed: c(33, { byInterstitialReason: { sdk_error: 22, timeout: 8, no_fill: 3 } }),
  });
  assert.deepEqual([f.control, f.treatment], [60, 60]);
  assert.equal(f.ready, 22, "shown + show_failed");
  assert.equal(f.askedForAd, 52, "treatment minus suppressed");
  assert.equal(f.readiness, 22 / 52);
  assert.equal(f.showRate, 20 / 60);
  assert.equal(f.dismissedPerShown, 18 / 20);
  const shown = f.continuation.find((r: { arm: string; outcome: string }) => r.arm === "treatment" && r.outcome === "shown");
  assert.equal(shown.rate, 15 / 20);
  assert.deepEqual(f.checkpointsByMarket, { ads: 50, IR: 10, AZ: 60, policy: 0, unknown: 0 });
  assert.deepEqual(f.loadFailureReasons, { sdk_error: 22, timeout: 8, no_fill: 3 });
});

test("version mix: one row per platform|version, shares of the window, and a reconciliation against the same dates", () => {
  const report = {
    versions: {
      "android|0.55.0": { app_open: 60, game_started: 500, game_completed: 450, first_open: 20 },
      "android|0.54.0": { app_open: 30, game_started: 200, game_completed: 180 },
      "web|0.55.0": { app_open: 10, game_started: 20, game_completed: 18 },
    },
    counts: { app_open: c(102), first_open: c(20), game_started: c(720), game_completed: c(648) },
    sources: { telemetryAeDates: ["2026-09-29"], telemetryDoDates: [] },
  };
  const v = M.versionMix(report);
  assert.deepEqual(v.rows.map((r: { platform: string; version: string }) => `${r.platform}|${r.version}`), ["android|0.55.0", "android|0.54.0", "web|0.55.0"]);
  const top = v.rows[0];
  assert.equal(top.shareOfAppOpens, 60 / 100);
  assert.equal(top.shareOfGameplay, 450 / 648);
  assert.equal(top.gamesPerAppOpen, 450 / 60);
  const android = v.platforms.find((p: { platform: string }) => p.platform === "android");
  assert.equal(android.appOpens, 90);
  const opens = v.reconcile.find((r: { label: string }) => r.label === "App opens");
  assert.deepEqual([opens.versions, opens.aggregate], [100, 102]);
  assert.equal(opens.delta, (100 - 102) / 102, "AE vs the exact ledger, made visible");
  assert.equal(M.versionMix({ versions: null }), null);
});

test("Android acquisition: referrer share excludes not-set; install_attributed is never used as a denominator", () => {
  const a = M.androidAcquisition({
    first_open: c(100, { bySource: { "google-play": 80, google: 15, "not-set": 5 }, byCampaign: { unknown: 97, fb4a: 3 }, byCountry: { IR: 40, DE: 60 }, byInstallAge: { h0_24: 90, d1_7: 10 } }),
    install_attributed: c(130, { bySource: { "google-play": 130 } }),
  });
  assert.equal(a.referrerShare, 95 / 100);
  assert.equal(a.campaignShare, 3 / 100);
  assert.equal(a.within24h, 90 / 100);
  assert.equal(a.installAttributed, 130);
  assert.deepEqual(a.byMarket, { ads: 60, IR: 40, AZ: 0, policy: 0, unknown: 0 });
  assert.equal("attributionRate" in a, false, "no install_attributed / first_open ratio exists");
});

test("economy summary: earned (telemetry) vs spent (exact), chest net, balance observations with shares", () => {
  const s = M.economySummary({
    spend: { bySink: { chest_key: { count: 16, coins: 16200 }, category_unlock: { count: 8, coins: 8000 } } },
    buckets: { balance: ["0_99", "100_499", "500_799"] },
    telemetryDates: ["2026-09-27"],
    telemetry: {
      sourceMix: { shape_stars: { events: 10, coins: 30000 }, chest_payout: { events: 16, coins: 15756 }, daily_chest: { events: 3, coins: 300 } },
      balanceAtGameCompleted: { "500_799": 20, "0_99": 60, "100_499": 20 },
    },
  });
  assert.equal(s.earned, 30000 + 15756 + 300);
  assert.equal(s.spent, 24200);
  assert.equal(s.net, 46056 - 24200);
  assert.equal(s.earnSpendRatio, 46056 / 24200);
  assert.equal(s.chestNet, 15756 - 16200, "a negative chest net is a sink");
  assert.deepEqual(s.balance.map((b: { bucket: string }) => b.bucket), ["0_99", "100_499", "500_799"], "bucket order, not insertion order");
  assert.equal(s.balance[0].share, 0.6);
  assert.equal(s.balanceObservations, 100);
  const noTelemetry = M.economySummary({ spend: { bySink: {} }, telemetry: null, telemetryReason: "range not covered" });
  assert.equal(noTelemetry.earned, null);
  assert.equal(noTelemetry.net, null, "no net figure from half the data");
});

test("range context: partial today, mixed sources, the history each range crosses", () => {
  const now = Date.parse("2026-09-29T11:00:00Z");
  const today = M.rangeContext({ period: "range", startDate: "2026-09-29", endDate: "2026-09-29", sources: { mode: "hybrid", telemetryAeDates: ["2026-09-29"], telemetryDoDates: [] } }, now);
  assert.equal(today.partial, true);
  assert.equal(today.closedDays, 0);
  assert.equal(today.crossed.length, 0);
  assert.ok(today.warnings.some((w: string) => /still running/.test(w)));
  assert.ok(!today.warnings.some((w: string) => /undercounts/.test(w)), "a post-ledger range gets no ledger warning");

  const week = M.rangeContext({ period: "range", startDate: "2026-09-22", endDate: "2026-09-28", sources: { mode: "hybrid", telemetryAeDates: ["2026-09-26", "2026-09-27", "2026-09-28"], telemetryDoDates: ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"] } }, now);
  assert.equal(week.partial, false);
  assert.equal(week.closedDays, 7);
  assert.deepEqual(week.crossed.map((h: { label: string }) => h.label), ["Durable Object telemetry became a 10% sample", "Analytics Engine began receiving the full stream", "Exact ledger activated", "telemetryToDo switched off"]);
  assert.ok(week.warnings.some((w: string) => /mixes telemetry sources/.test(w)));
  assert.ok(week.warnings.some((w: string) => /undercounts/.test(w)));

  const closed = M.rangeContext({ period: "range", startDate: "2026-09-27", endDate: "2026-09-28", sources: { mode: "hybrid", telemetryAeDates: ["2026-09-27", "2026-09-28"], telemetryDoDates: [] } }, now);
  assert.deepEqual(closed.crossed.map((h: { label: string }) => h.label), ["telemetryToDo switched off"]);
  assert.equal(closed.warnings.length, 0, "a clean closed range carries no warning at all");
});

test("the report cache: one request per distinct query, shared while in flight, reused until forced", async () => {
  let calls = 0;
  let release: (v: unknown) => void = () => {};
  const fetcher = () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const cache = M.createReportCache(fetcher, () => 1000);
  const a = cache.load("k", {}, false);
  const b = cache.load("k", {}, false);
  release({ ok: 1 });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1, "the double click shares one request");
  assert.equal(ra, rb);
  const again = await cache.load("k", {}, false);
  assert.equal(again.cached, true);
  assert.equal(calls, 1, "a cached range is not fetched again");
  const forced = cache.load("k", {}, true);
  release({ ok: 2 });
  assert.equal((await forced).cached, false);
  assert.equal(calls, 2, "only an explicit reload refetches");
  assert.equal(cache.requests, 2);
});

test("releases are matched to chart days by date", () => {
  const byDate = M.releasesByDate([{ version: "0.55.0", date: "2026-09-29" }, { version: "0.54.2", date: "2026-09-28" }, { version: "0.40.0", date: "2026-08-28" }], ["2026-09-28", "2026-09-29"]);
  assert.deepEqual(Object.keys(byDate).sort(), ["2026-09-28", "2026-09-29"]);
});
