// The Rewarded Ink Trial's post-session boundary (0.58.0) - the ONLY Ink entry point the Play Together and 2 Players
// features use besides inkTrialStore.ts. Those features stay structurally free of coins and ads
// (src/multiplayer/isolation.test.ts): they never import the ads module, a coin store or the Shop; they hand the
// moment "a session completed" to this file, and the offer itself lives in components/PostSessionInkOffer.tsx on the
// safe post-exit surface.

import { isRewardedUnitConfigured, preloadRewardedAd, type RewardedAdPlacement } from "./ads";
import { hasInkConfigAnswer, isInkOfferSurfaceOn } from "./ads/inkTrialConfig";

export { hasInkConfigAnswer };
import { getNextEligibleInk, type PostSessionSurface } from "./inkTrialStore";

export const POST_SESSION_INK_PLACEMENT: Record<PostSessionSurface, RewardedAdPlacement> = {
  playTogether: "play_together_ink_trial",
  twoPlayers: "two_players_ink_trial",
};

/**
 * Is a NEW Ink offer possible on this surface right now: an eligible ink, the surface on in the remote config, and
 * the Ink rewarded unit configured in this build (no unit = Ink OFF, never a fallback onto the Coin unit)?
 */
export function canOfferInkOn(surface: PostSessionSurface): boolean {
  return getNextEligibleInk() !== null && isInkOfferSurfaceOn(surface) && isRewardedUnitConfigured("ink");
}

/**
 * A session just completed: warm the rewarded ad so the post-exit offer is likely ready when it appears - the same
 * guarded preload the Classic round uses (consent, kill switch, adapter all checked inside; a no-op on the web).
 * Nothing is requested when no offer is possible.
 */
export function warmPostSessionInkAd(surface: PostSessionSurface): void {
  if (!canOfferInkOn(surface)) return;
  void preloadRewardedAd(POST_SESSION_INK_PLACEMENT[surface]);
}
