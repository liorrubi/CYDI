// The Classic Result screen's one Rewarded slot (0.57.1): WHETHER there is a legal Rewarded opportunity is decided
// exactly as in 0.57 (rewardedOfferCadence.ts: due + coins + ad capability, then interstitialController's
// claimResultAdLane()); WHAT it carries is the coin/ink rotation (app/inkTrialPolicy.ts). Ink never creates an
// opportunity, and nothing here reads an interstitial value (arm, cell, cadence, cap, rollout): the interstitial
// only answers "do I claim this screen" (claimResultAdLane) and "defer whatever is due on this exit"
// (deferInterstitialThisCycle). Rewarded and Ink policy is the same for every interstitial cell, control and
// non-participant.
//
// Try -> Buy has priority (owner decision, 8 Oct 2026): when the Trial's last play has just ended, the CTA owns
// that Result. No Rewarded offer renders there (one that was due simply stays due - its cadence untouched), and an
// interstitial opportunity due on its exit is DEFERRED - not shown, not consumed, not counted against the session
// cap - so it comes due again at the next legal opportunity.

import { decideResultOffer, markRewardedOfferShown, recordRewardedGameCompleted, type ResultOfferDecision } from "../../app/rewardedOfferCadence";
import { chooseClassicContent, type ClassicRewardedContent } from "../../app/inkTrialPolicy";
import { claimResultAdLane, deferInterstitialThisCycle, markRewardedOfferRenderedThisCycle, recordRewardedOfferDeferred } from "./interstitialController";
import { getClassicRotation, isInkOfferSurfaceOn } from "./inkTrialConfig";
import { isRewardedUnitConfigured } from "./rewardedAds";
import type { RewardedAdPlacement } from "./adPlacements";
import { advanceClassicRotation, getNextEligibleInk, getPendingCtaInk, peekClassicRotationSlot } from "../inkTrialStore";
import type { InkTrialInk } from "../analyticsSchema";

export type ClassicResultLane =
  | { kind: "none"; decision: ResultOfferDecision }
  | { kind: "offer"; content: ClassicRewardedContent }
  | { kind: "cta"; ink: InkTrialInk; deferredInterstitial: boolean };

export type ResultLaneDeps = {
  recordGameCompleted: () => boolean;
  claimLane: () => "interstitial" | "rewarded";
  recordDeferred: () => void;
  /** Defers an interstitial opportunity due on this Result's exit; returns whether one was due (and so deferred). */
  deferInterstitial: () => boolean;
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
  // Ink on Classic needs the remote config AND the Ink rewarded unit in this build (no unit = Ink OFF).
  inkOn: () => isInkOfferSurfaceOn("classic") && isRewardedUnitConfigured("ink"),
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
    // The CTA owns this Result: no lane claim, no Rewarded offer (it stays due), the interstitial deferred.
    return { kind: "cta", ink: ctaInk, deferredInterstitial: deps.deferInterstitial() };
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
 * Which rewarded placement - and so which AdMob unit - the NEXT Classic Rewarded opportunity will most likely use,
 * for the preload at drawing start: the rotation's scheduled slot and the eligible ink are already known then, so
 * the unit that will actually be offered is the one warmed (an Ink slot with no eligible ink is the coin fallback).
 * A preload is never an opportunity: it decides nothing about whether or what is offered.
 */
export function expectedClassicRewardedPlacement(deps: ResultLaneDeps = liveDeps): RewardedAdPlacement {
  if (!deps.inkOn()) return "shape_challenge_double_reward";
  const content = chooseClassicContent({ inkOn: true, scheduled: deps.scheduledSlot(), eligibleInk: deps.eligibleInk() });
  return content.kind === "ink" ? "shape_challenge_ink_trial" : "shape_challenge_double_reward";
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
