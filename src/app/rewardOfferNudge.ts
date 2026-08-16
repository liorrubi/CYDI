// Android-only nudges on the ×2 coins offer. Baseline: 489 offers produced 19
// "watch ad" taps (~3.9%), while 86% of started ads complete - so the bottleneck is
// the decision to start, not the ad itself. Two changes address that, and neither
// touches the reward mechanism: the offer states the concrete before/after amounts,
// and after three consecutive skips the next offer carries one small reminder.
//
// THE PLATFORM BOUNDARY LIVES HERE. Everything below is gated on isAndroidApp(), so
// the web/H5 build renders exactly what it renders today - see rewardOfferNudge.test.ts,
// which asserts that with the platform forced to "web".

import { isAndroidApp } from "../services/nativeShare";

/** Consecutive skips that must happen before the next offer carries a reminder. */
export const SKIPS_BEFORE_REMINDER = 3;

// Session state: module scope, so it resets on every cold start. Deliberately NOT
// persisted - a reminder is a nudge within one sitting, and remembering it across
// days would turn it into nagging.
let consecutiveSkips = 0;
let reminderShownThisSession = false;

/** True only inside the Android app - the single gate every nudge below shares. */
export function areRewardNudgesEnabled(): boolean {
  return isAndroidApp();
}

/** True only for the offer that immediately follows the 3rd consecutive skip, once per session, Android only. */
export function shouldShowReminder(): boolean {
  if (!areRewardNudgesEnabled()) return false;
  return !reminderShownThisSession && consecutiveSkips >= SKIPS_BEFORE_REMINDER;
}

/** Called when the reminder is actually rendered - it never appears twice in one session, whether or not it worked. */
export function markReminderShown(): void {
  reminderShownThisSession = true;
}

/**
 * Counts one skip toward the reminder streak - but ONLY when the player actually
 * turned down a real double.
 *
 * The streak measures genuine refusals, so the caller passes whether a rewarded ad
 * could truly have been watched at that moment. Walking past an offer that had no
 * watchable ad behind it (the button reads "Continue", or the daily cap is used up,
 * or an ad attempt already failed) is not a refusal and must not push the player
 * toward a reminder that says "one short ad doubles your coins". The dev-only math
 * route is deliberately NOT a qualifying route either, so it can never move these
 * semantics on the way to production.
 */
export function recordOfferSkipped(forfeitedRealDouble: boolean): void {
  if (!forfeitedRealDouble) return;
  consecutiveSkips += 1;
}

/** A granted double ends the streak - the player just did the thing we were nudging toward. */
export function recordRewardGranted(): void {
  consecutiveSkips = 0;
}

/** Test-only: clear session state between cases. */
export function _resetRewardNudgesForTests(): void {
  consecutiveSkips = 0;
  reminderShownThisSession = false;
}
