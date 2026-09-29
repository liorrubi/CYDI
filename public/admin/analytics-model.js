/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// CYDI admin analytics - the derived numbers behind /admin/analytics.
//
// PURE. No DOM, no fetch, no storage, no clock unless one is passed in. Every function
// takes the /api/analytics/report response (or part of it) and returns plain data the
// page renders. This is where every rate and its denominator is defined, once, so the
// page never computes the same thing two ways - and so worker/adminAnalyticsModel.test.ts
// can check each denominator directly.
//
// COST RULE. Nothing here may need data the report does not already carry. A metric that
// would need a new query, a new event or a new identifier does not belong in this file.

// ---------------------------------------------------------------------- dates ----

/** YYYY-MM-DD in Israel time - the report's day buckets are Israel days. */
export function israelDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function israelTimeLabel(ms) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------- basic maths ----

/** A rate, or null when the denominator is zero - never a silent 0%. */
export function rate(part, whole) {
  return whole > 0 ? part / whole : null;
}

export function total(counts, event) {
  return (counts && counts[event] && counts[event].total) || 0;
}

export function breakout(counts, event, map) {
  return (counts && counts[event] && counts[event][map]) || {};
}

function sumValues(map) {
  return Object.values(map || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

function sumEvents(counts, events) {
  return events.reduce((sum, e) => sum + total(counts, e), 0);
}

// ------------------------------------------------------------ analytics history ----

/**
 * Dated facts about how CYDI's analytics were collected. Each entry is a fact about the
 * PAST, so it cannot silently become wrong: when the architecture changes again, append
 * a new entry. Nothing on the page says "currently" on the strength of this list - what
 * the selected range was actually read from always comes from the response's `sources`.
 */
export const ANALYTICS_HISTORY = [
  {
    at: "2026-09-25T03:06:00Z",
    label: "Durable Object telemetry became a 10% sample",
    effect: "Telemetry stored in the Durable Object from here on is a 10% sample.",
  },
  {
    at: "2026-09-25T07:37:00Z",
    label: "Analytics Engine began receiving the full stream",
    effect: "Analytics Engine holds full, unsampled telemetry from here; 26 Sep is the first complete day.",
  },
  {
    at: "2026-09-26T19:35:09Z",
    label: "Exact ledger activated",
    effect:
      "Exact events are persisted before each response from here. Before it, the Durable Object could drop buffered events on hibernation (measured at roughly 22-26%), so exact counts before this moment are undercounts. 27 Sep is the first full day with the ledger active throughout.",
  },
  {
    at: "2026-09-27T09:14:48Z",
    label: "telemetryToDo switched off",
    effect: "From here telemetry is written to Analytics Engine only; the Durable Object keeps exact events.",
  },
];

export const EXACT_LEDGER_ACTIVATED_AT = ANALYTICS_HISTORY.find((h) => h.label === "Exact ledger activated").at;

/**
 * What the reader must know about the selected range before reading any number:
 * the dates, whether the last day is still running, which store each day's numbers came
 * from, and which historical changes fall inside the range.
 */
export function rangeContext(report, nowMs) {
  const today = israelDateKey(nowMs);
  const start = report.startDate;
  const end = report.endDate;
  const alltime = report.period === "alltime";
  const dates = alltime ? [] : datesBetween(start, end);
  const sources = report.sources || null;
  const aeDates = (sources && sources.telemetryAeDates) || [];
  const doDates = (sources && sources.telemetryDoDates) || (alltime ? [] : dates);
  const partial = !alltime && end === today;
  // A change "falls inside" the range when it happened on one of its Israel days.
  const crossed = alltime
    ? ANALYTICS_HISTORY.slice()
    : ANALYTICS_HISTORY.filter((h) => {
        const day = israelDateKey(Date.parse(h.at));
        return day >= start && day <= end;
      });
  const warnings = [];
  if (alltime) {
    warnings.push("Since-launch totals are the Durable Object's running counters. Telemetry in them is a sample from 25 Sep and stops growing once telemetry went to Analytics Engine only - use a dated range for gameplay.");
  }
  if (!alltime && doDates.length > 0 && aeDates.length > 0) {
    warnings.push(
      `This range mixes telemetry sources: ${doDates[0]} to ${doDates[doDates.length - 1]} come from the Durable Object (sampled or undercounted), ${aeDates[0]} onwards from Analytics Engine (full stream). Day-to-day telemetry changes across ${aeDates[0]} are a collection change, not a behaviour change.`,
    );
  } else if (!alltime && doDates.length > 0 && aeDates.length === 0) {
    warnings.push("Every day in this range predates Analytics Engine coverage: gameplay telemetry here is what the Durable Object recorded - sampled or undercounted, not the full stream.");
  }
  // Any range that starts on or before the activation day contains pre-ledger hours.
  if (!alltime && start <= israelDateKey(Date.parse(EXACT_LEDGER_ACTIVATED_AT))) {
    warnings.push("Exact-event counts (app opens, installs, ad outcomes, interstitials, purchases, shares) before 26 Sep 19:35Z are undercounts - the exact ledger was not active yet.");
  }
  if (partial) {
    warnings.push(`${end} is today and still running: compare it with a closed day only after it ends, or not at all.`);
  }
  if (sources && sources.reason && sources.mode === "durable-object" && !alltime) {
    warnings.push(`Telemetry fell back to the Durable Object: ${sources.reason}`);
  }
  return {
    today,
    start,
    end,
    alltime,
    dayCount: dates.length,
    partial,
    closedDays: dates.filter((d) => d < today).length,
    mode: sources ? sources.mode : null,
    aeDates,
    doDates,
    crossed,
    warnings,
  };
}

/**
 * Which events are exact (ledger) and which are telemetry. From the server's own list
 * when the report carries it; otherwise from the list that report notes describe.
 */
const FALLBACK_EXACT = [
  "app_open", "coin_spent", "first_open", "install_attributed", "interstitial_checkpoint", "interstitial_continuation",
  "interstitial_dismissed", "interstitial_load_failed", "mega_card_unlocked", "mp_room_created", "progression_milestone",
  "purchase_completed", "result_shared", "reward_ad_completed", "reward_ad_failed", "reward_ad_started",
  "reward_bonus_ad_completed", "reward_bonus_ad_failed", "reward_bonus_ad_started", "reward_fallback_used",
  "rewarded_ad_completed", "rewarded_ad_dismissed", "rewarded_ad_failed", "rewarded_ad_loaded", "rewarded_ad_requested",
  "rewarded_ad_shown", "shop_purchase_with_coins", "tutorial_completed", "tutorial_skipped",
];
export function exactEventSet(report) {
  const list = report && report.sources && report.sources.exactLedgerEvents;
  return new Set(Array.isArray(list) && list.length ? list : FALLBACK_EXACT);
}

// ------------------------------------------------------------- AE-date totals ----

/**
 * Totals of `events` over the Analytics Engine dates only, from the per-day series. Used
 * wherever a rate mixes an exact numerator with a telemetry denominator (or the reverse):
 * on Durable Object dates the telemetry side is a sample, so those dates must not enter
 * the rate. Returns null when the range has no series to split with.
 */
export function totalsOnDates(report, dates, events) {
  if (!report.days || !dates.length) return null;
  const want = new Set(dates);
  const out = {};
  for (const e of events) out[e] = 0;
  for (const day of report.days) {
    if (!want.has(day.date)) continue;
    for (const e of events) out[e] += total(day.counts, e);
  }
  return out;
}

// --------------------------------------------------------------- market groups ----

/** Google does not serve ads in these countries (the rewarded audit's POLICY_INELIGIBLE). */
export const POLICY_INELIGIBLE = ["IR", "CU", "KP", "SY"];

export const MARKET_GROUPS = [
  { id: "ads", label: "Ads markets", help: "Every country except IR, AZ and the other policy-ineligible ones - where ad delivery is expected." },
  { id: "IR", label: "IR", help: "Iran - Google serves no ads here." },
  { id: "AZ", label: "AZ", help: "Azerbaijan - no ad availability observed (an observation, not a policy)." },
  { id: "policy", label: "CU / KP / SY", help: "The other policy-ineligible countries." },
  { id: "unknown", label: "Unknown", help: "No country resolved (ZZ)." },
];

export function marketOf(country) {
  const c = String(country || "").toUpperCase();
  if (!c || c === "ZZ" || c === "UNKNOWN") return "unknown";
  if (c === "IR") return "IR";
  if (c === "AZ") return "AZ";
  if (POLICY_INELIGIBLE.includes(c)) return "policy";
  return "ads";
}

/** A byCountry map folded into the market groups; keys may be "CC" or "CC|rest". */
export function byMarket(map) {
  const out = { ads: 0, IR: 0, AZ: 0, policy: 0, unknown: 0 };
  for (const [key, n] of Object.entries(map || {})) out[marketOf(key.split("|")[0])] += Number(n) || 0;
  return out;
}

/** A "CC|reason" map folded to market -> reason -> count. */
export function byMarketReason(map) {
  const out = {};
  for (const [key, n] of Object.entries(map || {})) {
    const [country, reason] = key.split("|");
    const g = marketOf(country);
    out[g] = out[g] || {};
    out[g][reason || "unknown"] = (out[g][reason || "unknown"] || 0) + (Number(n) || 0);
  }
  return out;
}

// ------------------------------------------------------------ rewarded funnel ----

const OFFER_EVENTS = { x2: "reward_offer_shown", bonus: "reward_bonus_offer_shown" };
const START_EVENTS = ["reward_ad_started", "reward_bonus_ad_started"];
const COMPLETION_EVENTS = ["reward_ad_completed", "reward_bonus_ad_completed"];
const SKIP_EVENTS = ["reward_skipped", "reward_bonus_skipped"];
const FAIL_EVENTS = ["reward_ad_failed", "reward_bonus_ad_failed"];
const FUNNEL_EVENTS = [OFFER_EVENTS.x2, OFFER_EVENTS.bonus, ...START_EVENTS, ...COMPLETION_EVENTS, ...SKIP_EVENTS, ...FAIL_EVENTS];

function funnelFrom(counts) {
  const offersX2 = total(counts, OFFER_EVENTS.x2);
  const offersBonus = total(counts, OFFER_EVENTS.bonus);
  const offers = offersX2 + offersBonus;
  const starts = sumEvents(counts, START_EVENTS);
  const completions = sumEvents(counts, COMPLETION_EVENTS);
  const skips = sumEvents(counts, SKIP_EVENTS);
  const fails = sumEvents(counts, FAIL_EVENTS);
  return {
    offers,
    offersX2,
    offersBonus,
    starts,
    completions,
    skips,
    fails,
    startPerOffer: rate(starts, offers),
    completionPerStart: rate(completions, starts),
    completionPerOffer: rate(completions, offers),
    skipRate: rate(skips, offers),
  };
}

/**
 * The rewarded offer funnel: Offers -> (Ad available) -> Starts -> Completions, plus skips
 * and failures. Offers and skips are telemetry, starts/completions/failures are exact, so
 * rates are computed over the Analytics Engine dates only whenever the range has any - on
 * Durable Object dates the offer counts are a sample. `availability` joins in only when
 * the economy block has been loaded (it is the only place the per-offer ad flag lives).
 */
export function rewardedFunnel(report, economy) {
  const ctxAe = (report.sources && report.sources.telemetryAeDates) || [];
  const doDates = (report.sources && report.sources.telemetryDoDates) || [];
  const all = funnelFrom(report.counts || {});
  let basis = "range";
  let rates = all;
  if (doDates.length > 0 && ctxAe.length > 0) {
    const ae = totalsOnDates(report, ctxAe, FUNNEL_EVENTS);
    if (ae) {
      const counts = {};
      for (const [e, n] of Object.entries(ae)) counts[e] = { total: n };
      rates = funnelFrom(counts);
      basis = "ae-dates";
    } else {
      basis = "mixed";
    }
  } else if (doDates.length > 0) {
    basis = "do-only";
  }
  const t = economy && economy.telemetry && economy.telemetry.rewardFunnel && economy.telemetry.rewardFunnel.total;
  const availability = t
    ? {
        offers: t.offers,
        offersWithAd: t.offersWithAd,
        startsWithAd: t.startsWithAd,
        completionsWithAd: t.completionsWithAd,
        availabilityRate: rate(t.offersWithAd, t.offers),
        startPerAvailableOffer: rate(t.startsWithAd, t.offersWithAd),
        completionPerStartWithAd: rate(t.completionsWithAd, t.startsWithAd),
        dates: economy.telemetryDates || [],
      }
    : null;
  return { all, rates, basis, rateDates: basis === "ae-dates" ? ctxAe : [], availability };
}

/**
 * SDK-level rewarded delivery by market: each load attempt ends as `rewarded_ad_loaded`
 * or `rewarded_ad_unavailable` (background preloads and taps alike), so load success is
 * loaded / (loaded + unavailable) within a market.
 */
export function rewardedDelivery(counts) {
  const loaded = byMarket(breakout(counts, "rewarded_ad_loaded", "byCountry"));
  const unavailable = byMarket(breakout(counts, "rewarded_ad_unavailable", "byCountry"));
  const reasons = byMarketReason(breakout(counts, "rewarded_ad_unavailable", "byCountryReason"));
  const rows = MARKET_GROUPS.map((g) => {
    const l = loaded[g.id];
    const u = unavailable[g.id];
    return { market: g.id, label: g.label, help: g.help, loaded: l, unavailable: u, attempts: l + u, loadSuccess: rate(l, l + u), reasons: reasons[g.id] || {} };
  }).filter((r) => r.attempts > 0);
  return {
    rows,
    requested: total(counts, "rewarded_ad_requested"),
    shown: total(counts, "rewarded_ad_shown"),
    completed: total(counts, "rewarded_ad_completed"),
    failed: total(counts, "rewarded_ad_failed"),
    failedReasons: breakout(counts, "rewarded_ad_failed", "byReason"),
    unavailableReasons: breakout(counts, "rewarded_ad_unavailable", "byReason"),
  };
}

/**
 * The Rewarded experiment (0.55.0 v1: arm "x3" vs arm "plus100") read from the economy
 * block's multiplier x reward-size funnel, which already separates them (plus100 rows have
 * multiplier 1). Other x2 placements (chest, shop, Special, Mega, Artist) are listed apart.
 * Returns null when the economy block is not loaded or holds no experiment rows.
 */
export function rewardedExperiment(economy) {
  const rows = economy && economy.telemetry && economy.telemetry.rewardFunnel && economy.telemetry.rewardFunnel.byMultiplierRewardSize;
  if (!rows) return null;
  const arms = {};
  for (const [key, r] of Object.entries(rows)) {
    const arm = key.split("|")[0];
    const a = (arms[arm] = arms[arm] || { arm, offers: 0, offersWithAd: 0, startsWithAd: 0, completionsWithAd: 0, skips: 0 });
    a.offers += r.offers || 0;
    a.offersWithAd += r.offersWithAd || 0;
    a.startsWithAd += r.startsWithAd || 0;
    a.completionsWithAd += r.completionsWithAd || 0;
    a.skips += r.skips || 0;
  }
  const list = Object.values(arms)
    .map((a) => ({ ...a, startPerAvailableOffer: rate(a.startsWithAd, a.offersWithAd), completionPerStart: rate(a.completionsWithAd, a.startsWithAd), skipRate: rate(a.skips, a.offers) }))
    .sort((a, b) => ["x3", "plus100", "x2"].indexOf(a.arm) - ["x3", "plus100", "x2"].indexOf(b.arm));
  return { arms: list, hasPlus100: Boolean(arms.plus100) };
}

// --------------------------------------------------------------- interstitial ----

/**
 * Interstitial opportunities (checkpoints) -> outcome, per arm. Every checkpoint ends in
 * exactly one outcome (control, not_ready, shown, show_failed, suppressed), so:
 *   ready     = shown + show_failed   (an ad was loaded when the moment came)
 *   readiness = ready / (treatment - suppressed)   (suppressed never asks for an ad)
 *   show rate = shown / treatment
 * Continuation is interstitial_continuation / checkpoints for the same arm|outcome.
 */
export function interstitialFunnel(counts) {
  const cp = breakout(counts, "interstitial_checkpoint", "byArmOutcome");
  const cont = breakout(counts, "interstitial_continuation", "byArmOutcome");
  const cell = (map, arm, outcome) => Number(map[`${arm}|${outcome}`]) || 0;
  const armTotal = (map, arm) => Object.entries(map).filter(([k]) => k.split("|")[0] === arm).reduce((s, [, n]) => s + (Number(n) || 0), 0);
  const treatment = armTotal(cp, "treatment");
  const control = armTotal(cp, "control");
  const outcomes = {};
  for (const o of ["not_ready", "shown", "show_failed", "suppressed"]) outcomes[o] = cell(cp, "treatment", o);
  const ready = outcomes.shown + outcomes.show_failed;
  const askedForAd = treatment - outcomes.suppressed;
  const dismissed = total(counts, "interstitial_dismissed");
  const continuation = Object.keys(cp)
    .sort()
    .map((key) => {
      const [arm, outcome] = key.split("|");
      const checkpoints = Number(cp[key]) || 0;
      const continued = Number(cont[key]) || 0;
      return { arm, outcome, checkpoints, continued, rate: rate(continued, checkpoints) };
    });
  return {
    checkpoints: total(counts, "interstitial_checkpoint"),
    control,
    treatment,
    outcomes,
    ready,
    askedForAd,
    readiness: rate(ready, askedForAd),
    showRate: rate(outcomes.shown, treatment),
    dismissed,
    dismissedPerShown: rate(dismissed, outcomes.shown),
    continuation,
    loadFailures: total(counts, "interstitial_load_failed"),
    loadFailureReasons: breakout(counts, "interstitial_load_failed", "byInterstitialReason"),
    checkpointsByMarket: byMarket(breakout(counts, "interstitial_checkpoint", "byCountry")),
    cadence: breakout(counts, "interstitial_checkpoint", "byCadence"),
  };
}

// ------------------------------------------------------------- version mix ----

function compareVersions(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10));
  const pb = String(b).split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : -1;
    const y = Number.isFinite(pb[i]) ? pb[i] : -1;
    if (x !== y) return y - x;
  }
  return String(a) < String(b) ? -1 : 1;
}

/**
 * Platform x app-version rows from the report's `versions` map (Analytics Engine dates
 * only, one source for every column). Shares are of the whole window; "games per app
 * open" is completed games / app opens on the same row. `reconcile` compares the version
 * rows with the aggregate counts of the same dates, so a gap between AE and the exact
 * ledger is visible instead of hidden inside a share.
 */
export function versionMix(report) {
  const versions = report.versions;
  if (!versions) return null;
  const aeDates = (report.sources && report.sources.telemetryAeDates) || [];
  const rows = Object.entries(versions).map(([key, ev]) => {
    const [platform, version] = key.split("|");
    return {
      platform,
      version,
      appOpens: ev.app_open || 0,
      firstOpens: ev.first_open || 0,
      gamesStarted: ev.game_started || 0,
      gamesCompleted: ev.game_completed || 0,
    };
  });
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);
  const totals = { appOpens: sum("appOpens"), firstOpens: sum("firstOpens"), gamesStarted: sum("gamesStarted"), gamesCompleted: sum("gamesCompleted") };
  for (const r of rows) {
    r.shareOfAppOpens = rate(r.appOpens, totals.appOpens);
    r.shareOfGameplay = rate(r.gamesCompleted, totals.gamesCompleted);
    r.gamesPerAppOpen = rate(r.gamesCompleted, r.appOpens);
  }
  rows.sort((a, b) => (a.platform === b.platform ? compareVersions(a.version, b.version) : a.platform < b.platform ? -1 : 1));
  const platforms = {};
  for (const r of rows) {
    const p = (platforms[r.platform] = platforms[r.platform] || { platform: r.platform, appOpens: 0, firstOpens: 0, gamesStarted: 0, gamesCompleted: 0 });
    p.appOpens += r.appOpens;
    p.firstOpens += r.firstOpens;
    p.gamesStarted += r.gamesStarted;
    p.gamesCompleted += r.gamesCompleted;
  }
  for (const p of Object.values(platforms)) {
    p.shareOfAppOpens = rate(p.appOpens, totals.appOpens);
    p.shareOfGameplay = rate(p.gamesCompleted, totals.gamesCompleted);
    p.gamesPerAppOpen = rate(p.gamesCompleted, p.appOpens);
  }
  // The same dates' aggregate counts: exact app_open / first_open from the ledger, games
  // from AE. When the whole range is AE-covered that is simply the range totals.
  const doDates = (report.sources && report.sources.telemetryDoDates) || [];
  const events = ["app_open", "first_open", "game_started", "game_completed"];
  let aggregate = null;
  if (doDates.length === 0) {
    aggregate = {};
    for (const e of events) aggregate[e] = total(report.counts, e);
  } else {
    aggregate = totalsOnDates(report, aeDates, events);
  }
  const reconcile = aggregate
    ? [
        { label: "App opens", versions: totals.appOpens, aggregate: aggregate.app_open, note: "exact ledger" },
        { label: "First opens", versions: totals.firstOpens, aggregate: aggregate.first_open, note: "exact ledger" },
        { label: "Games started", versions: totals.gamesStarted, aggregate: aggregate.game_started, note: "Analytics Engine" },
        { label: "Games completed", versions: totals.gamesCompleted, aggregate: aggregate.game_completed, note: "Analytics Engine" },
      ].map((r) => ({ ...r, delta: r.aggregate > 0 ? (r.versions - r.aggregate) / r.aggregate : null }))
    : null;
  return { rows, platforms: Object.values(platforms), totals, dates: aeDates, reconcile };
}

/** Platform totals for the whole range - the long-standing "app vs web" view. */
export function platformTotals(counts) {
  const events = ["app_open", "game_started", "game_completed", "result_shared"];
  const maps = events.map((e) => breakout(counts, e, "byPlatform"));
  const keys = new Set();
  maps.forEach((m) => Object.keys(m).forEach((k) => keys.add(k)));
  return [...keys]
    .map((p) => ({
      platform: p,
      appOpens: maps[0][p] || 0,
      gamesStarted: maps[1][p] || 0,
      gamesCompleted: maps[2][p] || 0,
      shared: maps[3][p] || 0,
      completion: rate(maps[2][p] || 0, maps[1][p] || 0),
    }))
    .sort((a, b) => b.gamesStarted - a.gamesStarted);
}

// --------------------------------------------------------------- acquisition ----

/**
 * Android acquisition. `first_open` is "first launch observed for an installation whose
 * original installed version matches the running version" - an approximation of new
 * installs, never an exact install count. `install_attributed` is an independent decision
 * made from a different Play field, so the two are never divided into one another.
 */
export function androidAcquisition(counts) {
  const firstOpens = total(counts, "first_open");
  const sources = breakout(counts, "first_open", "bySource");
  const campaigns = breakout(counts, "first_open", "byCampaign");
  const noReferrer = sources["not-set"] || 0;
  const untagged = campaigns.unknown || 0;
  const installAge = breakout(counts, "first_open", "byInstallAge");
  return {
    firstOpens,
    sources,
    campaigns,
    withReferrerSource: firstOpens - noReferrer,
    referrerShare: rate(firstOpens - noReferrer, firstOpens),
    campaignShare: rate(firstOpens - untagged, firstOpens),
    byMarket: byMarket(breakout(counts, "first_open", "byCountry")),
    topCountries: Object.entries(breakout(counts, "first_open", "byCountry")).sort((a, b) => b[1] - a[1]).slice(0, 8),
    installAge,
    within24h: rate(installAge.h0_24 || 0, sumValues(installAge)),
    installAttributed: total(counts, "install_attributed"),
    attributedSources: breakout(counts, "install_attributed", "bySource"),
    attributedCampaigns: breakout(counts, "install_attributed", "byCampaign"),
  };
}

/** Web visits (app_open on the website) by referrer source - an event count, not people. */
export function webVisitSources(counts) {
  return breakout(counts, "app_open", "bySource");
}

// ------------------------------------------------------------------ economy ----

/**
 * The executive summary of the coin economy block. Earned coins are telemetry (Analytics
 * Engine, schema-2 clients - app 0.54.0 onwards - on `telemetryDates`); spent coins are
 * exact (the ledger, whole range). Both only exist from clients that report coins.
 */
export function economySummary(economy) {
  if (!economy) return null;
  const bySink = (economy.spend && economy.spend.bySink) || {};
  const spent = Object.values(bySink).reduce((s, r) => s + (r.coins || 0), 0);
  const purchases = Object.values(bySink).reduce((s, r) => s + (r.count || 0), 0);
  const t = economy.telemetry;
  const mix = (t && t.sourceMix) || {};
  const earned = t ? Object.values(mix).reduce((s, r) => s + (r.coins || 0), 0) : null;
  const keySpend = (bySink.chest_key && bySink.chest_key.coins) || 0;
  const chestPayout = t ? (mix.chest_payout && mix.chest_payout.coins) || 0 : null;
  const order = (economy.buckets && economy.buckets.balance) || [];
  const balance = t
    ? Object.entries(t.balanceAtGameCompleted || {})
        .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([bucket, observations]) => ({ bucket, observations }))
    : [];
  const observations = balance.reduce((s, b) => s + b.observations, 0);
  for (const b of balance) b.share = rate(b.observations, observations);
  return {
    earned,
    spent,
    purchases,
    net: earned === null ? null : earned - spent,
    earnSpendRatio: earned === null ? null : rate(earned, spent),
    keySpend,
    keyPurchases: (bySink.chest_key && bySink.chest_key.count) || 0,
    chestPayout,
    chestNet: chestPayout === null ? null : chestPayout - keySpend,
    dailyChest: t ? (mix.daily_chest && mix.daily_chest.coins) || 0 : null,
    balance,
    balanceObservations: observations,
    telemetryDates: economy.telemetryDates || [],
    telemetryReason: economy.telemetryReason || null,
  };
}

// ---------------------------------------------------------------- releases ----

/** Releases whose date falls on one of `dates`, keyed by date. */
export function releasesByDate(releases, dates) {
  const want = new Set(dates);
  const out = {};
  for (const r of releases || []) {
    if (!want.has(r.date)) continue;
    (out[r.date] = out[r.date] || []).push(r);
  }
  return out;
}

// --------------------------------------------------------------- report cache ----

/**
 * One report per distinct query, kept for the page session, plus in-flight de-duplication:
 * a second click while the first request is still running shares it. `load` never runs
 * the fetcher again for a cached key unless `force` is set (the page's explicit Reload).
 */
export function createReportCache(fetcher, nowFn) {
  const done = new Map();
  const inflight = new Map();
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    peek(key) {
      return done.get(key) || null;
    },
    load(key, params, force) {
      if (!force && done.has(key)) return Promise.resolve({ ...done.get(key), cached: true });
      if (inflight.has(key)) return inflight.get(key);
      requests++;
      const p = fetcher(params)
        .then((data) => {
          const entry = { data, loadedAt: nowFn() };
          done.set(key, entry);
          return { ...entry, cached: false };
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    clear() {
      done.clear();
    },
  };
}
