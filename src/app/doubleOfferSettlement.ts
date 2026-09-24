// Settling a ×2/×3 coin offer exactly once, however the player leaves it.
//
// The bug this exists to prevent (found in Stage-0, 24 Sep 2026): after a rewarded ad
// had genuinely granted the bonus, the extra coins were credited ONLY by the offer's own
// "Continue" button. Leaving the result screen any other way - Next Shape, Try Again,
// Back to Map - ran the screen's forfeit path instead, which dropped the bonus the
// player had already earned AND recorded `reward_skipped` for an ad they had watched.
//
// The rule now: once the double is earned, every exit settles it - the same bonus
// bookkeeping and the same credit as Continue - and exactly once. `reward_skipped` is
// left to offers that were genuinely not earned. Nothing about how the ad is loaded or
// shown is touched; this only decides what happens AFTER the SDK's reward callback.
//
// Pure (no React, no storage) so both halves can be tested under plain Node.

export type OfferSettlementDeps = {
  /** Bonus-round bookkeeping (app/bonusRewardRound.ts), run once at settlement. */
  resolveBonusRewardRound(options: { wasBonusRound: boolean; granted: boolean; forfeitedRealOffer: boolean }): void;
  /** The offer's own onResolved prop: the screen credits `finalAmount - amount`. */
  onResolved(finalAmount: number, anchorEl: HTMLElement | null): void;
};

export type OfferSettlement = {
  /** Settles with the given result. Returns false (and does nothing) if already settled. */
  settle(result: { granted: boolean; finalAmount: number }, anchorEl: HTMLElement | null): boolean;
  isSettled(): boolean;
};

export function createOfferSettlement(wasBonusRound: boolean, deps: OfferSettlementDeps): OfferSettlement {
  let settled = false;
  return {
    settle(result, anchorEl) {
      if (settled) return false;
      settled = true;
      deps.resolveBonusRewardRound({ wasBonusRound, granted: result.granted, forfeitedRealOffer: false });
      deps.onResolved(result.finalAmount, anchorEl);
      return true;
    },
    isSettled: () => settled,
  };
}

/**
 * What leaving the result screen does to an offer that is still on screen:
 * - "none":     no offer open (never shown, or already settled/skipped).
 * - "finalize": the double was already earned - settle it; never a skip.
 * - "skip":     not earned - the existing forfeit (reward_skipped), unchanged.
 */
export function offerExitAction(offerOpen: boolean, earnedFinalize: (() => void) | null): "none" | "finalize" | "skip" {
  if (!offerOpen) return "none";
  return earnedFinalize !== null ? "finalize" : "skip";
}
