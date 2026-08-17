// Periodic 3× reward bonus. Every Nth completed round, the standing "watch an ad to
// double your coins" offer becomes a 3× offer instead. Everything about the existing
// rewarded-ad flow is reused unchanged - this module only answers two questions:
// "is THIS offer a bonus one?" and "was the bonus consumed?".
//
// THE COUNTER IS NOT NEW. `progress.completedRounds` has always been incremented by
// tutorialStore.recordRoundCompleted() when a shape-challenge round is finished (drawn
// and scored, pass or fail), it already persists through saveStore, and it already
// survives restarts and legacy imports. Reusing it means there is no second notion of
// "a round" to keep in sync, and no new persistence to get wrong.
//
// SCOPE: only the shape-challenge offer. recordRoundCompleted() is called from exactly
// one place (ShapeChallengeScreen, immediately before the offer is shown), so that
// offer is the only one that reliably follows a counted round. Chest/shop/mega/special
// /artist offers are deliberately untouched and keep their existing ×2 - counting them
// would mean incrementing completedRounds elsewhere, which also drives the onboarding
// and achievements tutorial thresholds.

import { getSaveData, updateSaveData } from "../services/saveStore";
import type { RewardedAdPlacement } from "../services/ads";

/**
 * Completed rounds between 3× bonus offers - the 7th, 14th, 21st … round.
 * THE single source of truth: nothing anywhere else hard-codes this number.
 */
export const BONUS_REWARD_ROUND_INTERVAL = 7;

/** Coin multiplier on a bonus round. Only ever paid out for a confirmed rewarded-ad completion. */
export const BONUS_REWARD_MULTIPLIER = 3;

/** Coin multiplier on every other round - the long-standing ×2, unchanged. */
export const STANDARD_REWARD_MULTIPLIER = 2;

/** The one offer that directly follows a counted round (see SCOPE above). */
export const BONUS_REWARD_PLACEMENT: RewardedAdPlacement = "shape_challenge_double_reward";

/**
 * Is the offer being shown right now a 3× bonus offer?
 *
 * Pure read - it never mutates, so it is safe to call during render and cannot be
 * thrown off by React re-rendering or StrictMode's double invocation. By the time the
 * offer mounts, recordRoundCompleted() has already counted this round, so the round
 * the player just finished IS `completedRounds`.
 */
export function isBonusRewardRound(placement: RewardedAdPlacement): boolean {
  if (placement !== BONUS_REWARD_PLACEMENT) return false;
  const progress = getSaveData().progress;
  const rounds = progress.completedRounds;
  // Number() || 0 : saves written before this field existed hydrate to the default,
  // but a hand-edited or partially recovered save could still carry anything.
  const lastBonus = Number(progress.lastBonusRewardRound) || 0;
  // ">=", not "=== interval": a bonus that came due but was never settled stays due.
  // That covers both an ad that could not be served AND a round that paid no coins and
  // so never showed an offer at all - neither may quietly swallow the player's bonus.
  return rounds > 0 && rounds - lastBonus >= BONUS_REWARD_ROUND_INTERVAL;
}

/** The multiplier an offer advertises and pays out. */
export function rewardMultiplier(isBonusRound: boolean): number {
  return isBonusRound ? BONUS_REWARD_MULTIPLIER : STANDARD_REWARD_MULTIPLIER;
}

/**
 * Settles a bonus round once the player is done with the offer.
 *
 * The bonus is consumed in exactly two cases: it was actually granted, or the player
 * turned down an offer that genuinely had a watchable ad behind it (their choice - the
 * same "was a real double on the table?" test the skip-streak nudge already uses).
 *
 * Anything else is a technical failure - no ad available, failed to load, errored,
 * consent-blocked - and MUST NOT cost the entitlement: the marker is left where it is,
 * so the bonus stays due and the very next offer is a 3× one again. A no-op for
 * ordinary rounds.
 */
export function resolveBonusRewardRound(options: {
  wasBonusRound: boolean;
  granted: boolean;
  forfeitedRealOffer: boolean;
}): void {
  if (!options.wasBonusRound) return;
  if (!options.granted && !options.forfeitedRealOffer) return;
  updateSaveData((data) => {
    // The cycle restarts from the round the bonus was settled on, not from a fixed
    // multiple, so a carried-over bonus doesn't shorten the next interval.
    data.progress.lastBonusRewardRound = data.progress.completedRounds;
  });
}
