// Pure mapping from a rewarded-ad outcome to what DoubleCoinsOffer should do next -
// extracted out of the component so this branching is unit-testable without a DOM
// (this codebase's test runner is plain node:test, no jsdom/component-testing
// framework). The ONLY outcome that grants the reward is "rewarded" - the SDK's own
// confirmed-completion callback, never merely opening the ad.
//
// Watching an ad is the ONLY route to the double in a user-facing build. Nothing here
// ever routes to the math quiz: a dismissal returns to the offer (nothing granted, the
// player may try again), and unavailable/error (which also covers consent-blocked,
// since that surfaces as an "unavailable" status with reason "consent_blocked") returns
// to the offer with `adUnavailable` set, so the component can show a short "ads aren't
// available right now" note instead of granting anything.

import type { RewardedAdResult } from "../services/ads";

export type AdOfferOutcome = {
  nextPhase: "feedback" | "offer";
  grantSource?: "ad";
  /** The ad could not be served at all - the caller shows an unobtrusive notice. Never implies a grant. */
  adUnavailable?: boolean;
};

export function resolveAdOutcome(result: RewardedAdResult): AdOfferOutcome {
  switch (result.status) {
    case "rewarded":
      return { nextPhase: "feedback", grantSource: "ad" };
    case "dismissed":
      return { nextPhase: "offer" };
    case "unavailable":
    case "error":
      return { nextPhase: "offer", adUnavailable: true };
  }
}

/**
 * Does this outcome consume one of a caller's capped daily doubles (paid shop chests)?
 * ONLY a confirmed ad reward does - the counter tracks doubles actually GRANTED, matching
 * both the player-facing "Chest doubles left today" label and recordPaidChestDoubleUsed()'s
 * own "marks one double as used" contract. An ad that is unavailable, blocked by consent,
 * fails to load, errors, times out, or is closed early grants nothing and so must cost the
 * player nothing; they are free to try again. Kept next to resolveAdOutcome (rather than
 * inline in the component) so this guarantee is unit-testable without a DOM.
 */
export function consumesDoubleAttempt(outcome: AdOfferOutcome): boolean {
  return outcome.grantSource === "ad";
}
