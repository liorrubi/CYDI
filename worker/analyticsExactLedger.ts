/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Analytics Phase 2: AnalyticsDO as a narrow, DURABLE exact ledger; Analytics Engine
// (analyticsShadow.ts) as the primary store for telemetry.
//
// WHY. AnalyticsDO buffers counters in memory (5 events / 15 s) and persists only at
// request time. Cloudflare hibernates a fetch-only Durable Object after 10 s with no
// request and discards its memory, so at CYDI's traffic density ~22-26% of what reached
// the DO never became a persisted counter (measured 25 Sep 2026, deploy-free window -
// see reports/2026-09-25-analytics-unattended/05). Exact events must not ride on that
// buffer.
//
// HOW (when enabled):
//  - Every accepted envelope still goes to Analytics Engine, unsampled (the Phase 1 write).
//  - Envelopes named in EXACT_LEDGER_EVENTS go to AnalyticsDO's `/ledger` route, which
//    ingests and then PERSISTS BEFORE RESPONDING - nothing is left in memory for a
//    hibernation to discard. They are never sampled.
//  - Everything else is telemetry. By default it no longer goes to the DO at all (AE is
//    its store). `telemetryToDo: true` keeps sending the existing shed-policy sample to the
//    DO - riding in the SAME `/ledger` request, so it costs no extra DO request and is
//    durable too - for a transition period while reports still read the DO.
//
// GATE. A block inside the existing `config:analytics-breaker` KV value, read by the same
// cached read as the breaker and the shed policy - zero additional KV reads. Absent,
// malformed or `enabled:false` means exactly today's behaviour. The breaker (`disabled`)
// still wins outright.
//
// ORDER OF OPERATIONS for enabling: deploy this code FIRST, then write the block. The code
// running in production before this change does not recognise the extra key: it keeps
// parsing `shed` normally but would stop honouring `disabled:true` while the key is present.

import { checkedEnvelopes, parseIngest, type IngestPath, type ParsedIngest } from "./analyticsIngest";

// The gate's shape lives in a dependency-free module the Ops Panel can import too.
export { EXACT_LEDGER_OFF, isValidExactLedgerConfig, type ExactLedgerConfig } from "./analyticsExactLedgerConfig";

/**
 * Events that must be counted exactly: every one of them is a fact, not a sample.
 *
 * Derived from analyticsShedding.ALWAYS_PRESERVE (plus the interstitial A/B pair that is
 * preserved today via KV preserveExtra), minus one deliberate exclusion:
 *
 *  - mp_game_started is emitted by EVERY player in a room (~5x mp_room_created), so it is
 *    the largest "preserved" event, and nothing about it is money or acquisition. It stays
 *    in Analytics Engine, unsampled, where the multiplayer-guard operator can still read it.
 *    mp_room_created (one per room, the guard's decision input) stays exact.
 *
 * An event not listed here is telemetry. A new event therefore defaults to AE-only - the
 * cheap direction for quota; add it here if it must be exact.
 */
export const EXACT_LEDGER_EVENTS: ReadonlySet<string> = new Set([
  // Acquisition and the session denominator.
  "first_open",
  "install_attributed",
  "app_open",
  // Onboarding - once per install, cannot be resampled later.
  "tutorial_completed",
  "tutorial_skipped",
  // Monetization / economy.
  "purchase_completed",
  "shop_purchase_with_coins",
  "mega_card_unlocked",
  // Rewarded ad funnel outcomes.
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
  // Interstitial experiment: arms and outcomes must be exact for the A/B read.
  "interstitial_checkpoint",
  "interstitial_continuation",
  "interstitial_load_failed",
  "interstitial_dismissed",
  // Virality and the multiplayer guard's input.
  "result_shared",
  "mp_room_created",
]);

export type LedgerSplit = { exact: unknown[]; telemetry: unknown[] };

/**
 * Splits one parsed ingest body into exact-ledger and telemetry envelopes, or returns null
 * when the request must take TODAY's path instead - which then answers it exactly as
 * production does:
 *
 *  - the body is not something the DO would accept as a whole (size, JSON, batch shape);
 *  - a single-event (`/event`) request whose envelope the DO would reject. Today that is an
 *    HTTP 400 from the DO ("invalid event" / "invalid params", subject to the shed dice),
 *    and Phase 2 must not turn it into a 204 or a 200.
 *
 * Classification uses the DO's own per-envelope acceptance (checkedEnvelopes), computed
 * once per request and shared with the AE shadow. Inside a batch an invalid entry is
 * telemetry: today the DO skips it with a 200, and so does Phase 2.
 */
export function splitParsed(parsed: ParsedIngest): LedgerSplit | null {
  if (parsed.envelopes === null) return null;
  const checked = checkedEnvelopes(parsed);
  if (parsed.path === "/event" && checked[0]?.eventName === null) return null;
  const split: LedgerSplit = { exact: [], telemetry: [] };
  for (const c of checked) {
    if (c.eventName !== null && EXACT_LEDGER_EVENTS.has(c.eventName)) split.exact.push(c.envelope);
    else split.telemetry.push(c.envelope);
  }
  return split;
}

/** Convenience for tests and one-off callers: parse, then split. */
export function splitForLedger(path: IngestPath, bodyText: string): LedgerSplit | null {
  return splitParsed(parseIngest(path, bodyText));
}
