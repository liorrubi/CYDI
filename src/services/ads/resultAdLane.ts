// The Classic Result screen's one Rewarded slot (0.57.1): WHETHER there is a legal Rewarded opportunity is decided
// exactly as in 0.57 (rewardedOfferCadence.ts: due + coins + ad capability, then interstitialController's
// claimResultAdLane()); WHAT it carries is the coin/ink rotation (app/inkTrialPolicy.ts). Ink never creates an
// opportunity, and nothing here reads an interstitial value - the interstitial only answers "do I claim this screen"
// (claimResultAdLane) and "is one due on this exit" (isInterstitialDueThisCycle, read-only).
//
// One card per Result: a pending Try -> Buy CTA (not an ad) is placed so that the interstitial is touched exactly
// where 0.57 touched it - claimResultAdLane() is still called only on a Result with a legal Rewarded opportunity:
//  - such a Result whose lane is rewarded: the CTA takes the slot and commits the lane like a rendered offer; the
//    Rewarded offer stays due (cadence untouched) and renders on a later Result;
//  - any other Result: the CTA appears only when no treatment interstitial is due on its exit, so it never shares
//    a screen with an ad and never changes an interstitial's claim, reservation or outcome.

import { decideResultOffer, markRewardedOfferShown, recordRewardedGameCompleted, type ResultOfferDecision } from "../../app/rewardedOfferCadence";
import { chooseClassicContent, type ClassicRewardedContent } from "../../app/inkTrialPolicy";
import { claimResultAdLane, isInterstitialDueThisCycle, markRewardedOfferRenderedThisCycle, recordRewardedOfferDeferred } from "./interstitialController";
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
  /** Diagnostic read only: is a TREATMENT interstitial due on this Result's exit? Never claims or reserves. */
  interstitialDue: () => boolean;
  /** The 0.57 "a Rewarded card is on this Result" lane commit (markRewardedOfferRenderedThisCycle). */
  markLaneRendered: () => void;
  pendingCtaInk: () => InkTrialInk | null;
  inkOn: () => boolean;
  scheduledSlot: () => "coin" | "ink";
  eligibleInk: () => InkTrialInk | null;
};

const liveDeps: ResultLaneDeps = {
  recordGameCompleted: recordRewardedGameCompleted,
  claimLane: claimResultAdLane,
  recordDeferred: recordRewardedOfferDeferred,
  interstitialDue: isInterstitialDueThisCycle,
  markLaneRendered: markRewardedOfferRenderedThisCycle,
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

  if (eligible !== "show") {
    // A pending CTA may use a Result with no Rewarded opportunity - but the interstitial lane is never asked here
    // (0.57 never asked it on such a Result either): the CTA simply waits whenever a treatment interstitial is due
    // on this exit, so nothing about the interstitial's claim, reservation or outcome can change.
    if (ctaInk !== null && !deps.interstitialDue()) return { kind: "cta", ink: ctaInk };
    return { kind: "none", decision: eligible };
  }
  if (deps.claimLane() === "interstitial") {
    deps.recordDeferred();
    return { kind: "none", decision: "pending_interstitial" };
  }
  if (ctaInk !== null) {
    // A legal Rewarded opportunity whose lane is rewarded: the CTA takes the slot exactly as an offer would - the
    // lane is committed like a rendered offer, so the interstitial records what 0.57 would have recorded here.
    // The Rewarded cadence is NOT restarted: the offer stays due and renders on a later Result.
    deps.markLaneRendered();
    return { kind: "cta", ink: ctaInk };
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
