// Pure mapping from a rewarded-ad outcome to what DoubleCoinsOffer should do next -
// extracted out of the component so this branching is unit-testable without a DOM
// (this codebase's test runner is plain node:test, no jsdom/component-testing
// framework). The ONLY outcome that grants the reward is "rewarded" - the SDK's own
// confirmed-completion callback, never merely opening the ad. A dismissal returns to
// the offer (fallback still visible, nothing granted); unavailable/error (which also
// covers consent-blocked, since that surfaces as an "unavailable" status with reason
// "consent_blocked") fall through straight into the existing math-quiz fallback.

import type { RewardedAdResult } from "../services/ads";

export type AdOfferOutcome = {
  nextPhase: "feedback" | "quiz" | "offer";
  grantSource?: "ad";
};

export function resolveAdOutcome(result: RewardedAdResult): AdOfferOutcome {
  switch (result.status) {
    case "rewarded":
      return { nextPhase: "feedback", grantSource: "ad" };
    case "dismissed":
      return { nextPhase: "offer" };
    case "unavailable":
    case "error":
      return { nextPhase: "quiz" };
  }
}
