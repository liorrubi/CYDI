// 0.59.0 Category "Unlock Now" - the pure rules. One loaded rewarded ad pays exactly the coins still missing for
// the next category (never more than UNLOCK_NOW_MAX_TOPUP) and the category unlocks at once, so the ad creates no
// spare coins. At most once per local day, Android only, behind the remote flag `coin.unlockNow` (absent = OFF).

export const UNLOCK_NOW_MAX_TOPUP = 250;

export type UnlockNowInput = {
  /** The Android app (Rewarded exists nowhere else). */
  android: boolean;
  /** Remote flag coin.unlockNow. */
  flagOn: boolean;
  usedToday: boolean;
  /** At least one category is still locked. */
  anyLocked: boolean;
  /** The next category's price (by purchase order) and the balance now. */
  price: number;
  coins: number;
};

/** May "Unlock Now" be offered (before ad readiness, which the screen checks separately)? */
export function isUnlockNowEligible(input: UnlockNowInput): boolean {
  if (!input.android || !input.flagOn || input.usedToday || !input.anyLocked) return false;
  const shortfall = input.price - input.coins;
  return shortfall > 0 && shortfall <= UNLOCK_NOW_MAX_TOPUP;
}

/**
 * What the granted ad credits: the shortfall at the moment of the grant (the balance may have moved while the ad
 * played), clamped to 0..UNLOCK_NOW_MAX_TOPUP. The caller unlocks only if the balance then covers the price.
 */
export function unlockNowCredit(price: number, coinsNow: number): number {
  return Math.min(UNLOCK_NOW_MAX_TOPUP, Math.max(0, Math.round(price - coinsNow)));
}
