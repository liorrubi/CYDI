/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Client-side analytics event classes and the sampling decision (Phase 3).
//
// EXACT: business facts counted by the durable AnalyticsDO ledger. NEVER sampled on the
//   client. This list must equal worker/analyticsExactLedger.ts EXACT_LEDGER_EVENTS - it is
//   restated here (not imported) so the web/Android bundle never pulls Worker/DO code in, and
//   a parity test fails the build the moment the two lists drift.
// DIAGNOSTIC: reliability/UX diagnostics whose value is statistical. May use a lower keep
//   rate than telemetry. Nothing is removed from the taxonomy here - see the Phase 3 report
//   for proposed removals.
// TELEMETRY: everything else (gameplay/funnel trends). May be sampled.
//
// SAMPLING UNIT: the analytics SESSION. A session's telemetry is either kept whole or
// dropped whole, decided deterministically from the session id, so every funnel inside a
// session (started -> completed -> shared, offer -> ad -> reward, round -> finish) is kept
// or dropped together and no stage is systematically over- or under-represented. Diagnostic
// sessions are a nested subset of telemetry sessions (same bucket, lower threshold), so a
// kept diagnostic always sits inside a kept telemetry session.

export type AnalyticsEventClass = "exact" | "telemetry" | "diagnostic";

export const CLIENT_EXACT_EVENTS: ReadonlySet<string> = new Set([
  "first_open",
  "install_attributed",
  "app_open",
  "tutorial_completed",
  "tutorial_skipped",
  "purchase_completed",
  "shop_purchase_with_coins",
  "mega_card_unlocked",
  "coin_spent",
  "progression_milestone",
  "rewarded_ad_requested",
  "rewarded_ad_loaded",
  "rewarded_ad_shown",
  "rewarded_ad_completed",
  "rewarded_ad_dismissed",
  "rewarded_ad_failed",
  "reward_ad_started",
  "reward_ad_completed",
  "reward_ad_failed",
  "reward_bonus_ad_started",
  "reward_bonus_ad_completed",
  "reward_bonus_ad_failed",
  "reward_fallback_used",
  "interstitial_checkpoint",
  "interstitial_continuation",
  "interstitial_load_failed",
  "interstitial_dismissed",
  "result_shared",
  "mp_room_created",
  "ink_trial",
]);

/** Reliability/UX diagnostics - statistically useful, individually disposable. */
export const CLIENT_DIAGNOSTIC_EVENTS: ReadonlySet<string> = new Set([
  "mp_disconnect",
  "mp_resume_offered",
  "mp_resume_success",
  "mp_resume_failed",
  "mp_leave_confirmed",
  "mp_leave_cancelled",
  "daily_shape_fallback",
  "reward_reminder_shown",
  "reward_double_tutorial_shown",
  "result_actions_tutorial_shown",
]);

export function classifyEvent(eventName: string): AnalyticsEventClass {
  if (CLIENT_EXACT_EVENTS.has(eventName)) return "exact";
  if (CLIENT_DIAGNOSTIC_EVENTS.has(eventName)) return "diagnostic";
  return "telemetry";
}

/** Stable 0-99 bucket for a session id (FNV-1a). The same session always lands in the same bucket. */
export function sessionBucket(sessionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export type SamplingRates = { telemetryKeepPercent: number; diagnosticKeepPercent: number; telemetryDisabled: boolean };

/**
 * Keep this event? Exact events: always. Telemetry: when the session's bucket is below the
 * telemetry rate (and telemetry is not disabled). Diagnostics: below the smaller of the two
 * rates, so diagnostic sessions are always a subset of telemetry sessions.
 */
export function shouldKeepEvent(eventName: string, sessionId: string, rates: SamplingRates): boolean {
  const cls = classifyEvent(eventName);
  if (cls === "exact") return true;
  if (rates.telemetryDisabled) return false;
  const bucket = sessionBucket(sessionId);
  if (cls === "telemetry") return bucket < rates.telemetryKeepPercent;
  return bucket < Math.min(rates.telemetryKeepPercent, rates.diagnosticKeepPercent);
}

/** The keep percent that applied to a kept event - carried on the envelope only when < 100, so reports can weight it. */
export function appliedKeepPercent(eventName: string, rates: SamplingRates): number {
  const cls = classifyEvent(eventName);
  if (cls === "exact") return 100;
  if (cls === "telemetry") return rates.telemetryKeepPercent;
  return Math.min(rates.telemetryKeepPercent, rates.diagnosticKeepPercent);
}
