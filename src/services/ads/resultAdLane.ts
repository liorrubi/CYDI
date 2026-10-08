// The Classic Result screen's one Rewarded slot (0.57.1): WHETHER there is a legal Rewarded opportunity is decided
// exactly as in 0.57 (rewardedOfferCadence.ts: due + coins + ad capability, then interstitialController's
// claimResultAdLane()); WHAT it carries is the coin/ink rotation (app/inkTrialPolicy.ts). Ink never creates an
// opportunity, and nothing here reads an interstitial value - the interstitial only answers "do I claim this screen".
//
// One card per Result: a pending Try -> Buy CTA takes the screen before any Rewarded offer (the offer then simply
// stays due, its cadence untouched, and renders on a later Result). The CTA is not an ad; it still asks the lane
// first, and holds the screen with deferInterstitialThisCycle() so no interstitial follows it.

import { decideResultOffer, markRewardedOfferShown, recordRewardedGameCompleted, type ResultOfferDecision } from "../../app/rewardedOfferCadence";
import { chooseClassicContent, type ClassicRewardedContent } from "../../app/inkTrialPolicy";
import { claimResultAdLane, deferInterstitialThisCycle, markRewardedOfferRenderedThisCycle, recordRewardedOfferDeferred } from "./interstitialController";
import { getClassicRotation, isInkOfferSurfaceOn } from "./inkTrialConfig";
import { advanceClassicRotation, getNextEligibleInk, getPendingCtaInk, peekClassicRotationSlot } from "../inkTrialStore";
import type { InkTrialInk } from "../analyticsSchema";

export type ClassicResultLane =
  | { kind: "none"; decision: ResultOfferDecision | "pending_cta" }
  | { kind: "offer"; content: ClassicRewardedContent }
  | { kind: "cta"; ink: InkTrialInk };

export type ResultLaneDeps = {
  recordGameCompleted: () => boolean;
  claimLane: () => "interstitial" | "rewarded";
  recordDeferred: () => void;
  deferInterstitial: () => void;
  pendingCtaInk: () => InkTrialInk | null;
  inkOn: () => boolean;
  scheduledSlot: () => "coin" | "ink";
  eligibleInk: () => InkTrialInk | null;
};

const liveDeps: ResultLaneDeps = {
  recordGameCompleted: recordRewardedGameCompleted,
  claimLane: claimResultAdLane,
  recordDeferred: recordRewardedOfferDeferred,
  deferInterstitial: deferInterstitialThisCycle,
  pendingCtaInk: getPendingCtaInk,
  inkOn: () => isInkOfferSurfaceOn("classic"),
  scheduledSlot: () => peekClassicRotationSlot(getClassicRotation()),
  eligibleInk: getNextEligibleInk,
};

/**
 * Called once per completed, scored, non-practice Classic round - where 0.57 inlined the same steps. The rewarded
 * cadence always advances first (exactly one recordRewardedGameCompleted per round).
 */
export function decideClassicResultLane(input: { coinsEarned: number; canOfferAd: boolean }, deps: ResultLaneDeps = liveDeps): ClassicResultLane {
  const due = deps.recordGameCompleted();
  const eligible = decideResultOffer({ due, interstitialDue: false, coinsEarned: input.coinsEarned, canOfferAd: input.canOfferAd });

  const ctaInk = deps.pendingCtaInk();
  if (ctaInk !== null) {
    // The CTA asks the lane like an offer would. An interstitial that claims it keeps it (the CTA waits for a
    // later Result); otherwise the CTA holds the screen and the interstitial is deferred, never consumed.
    if (deps.claimLane() === "interstitial") {
      if (eligible === "show") deps.recordDeferred();
      return { kind: "none", decision: eligible === "show" ? "pending_interstitial" : eligible };
    }
    deps.deferInterstitial();
    return { kind: "cta", ink: ctaInk };
  }

  if (eligible !== "show") return { kind: "none", decision: eligible };
  if (deps.claimLane() === "interstitial") {
    deps.recordDeferred();
    return { kind: "none", decision: "pending_interstitial" };
  }
  const inkOn = deps.inkOn();
  const content = chooseClassicContent({
    inkOn,
    scheduled: inkOn ? deps.scheduledSlot() : "coin",
    eligibleInk: inkOn ? deps.eligibleInk() : null,
  });
  return { kind: "offer", content };
}

/**
 * The offer is genuinely on screen (coin or ink): the cadence restarts, this Result's lane is rewarded (no
 * interstitial may follow from it) and - only when the rotation scheduled it - the rotation moves one slot.
 */
export function commitClassicOfferRendered(content: ClassicRewardedContent): void {
  markRewardedOfferShown();
  markRewardedOfferRenderedThisCycle();
  if (content.rotationSlot !== undefined) advanceClassicRotation(getClassicRotation());
}
