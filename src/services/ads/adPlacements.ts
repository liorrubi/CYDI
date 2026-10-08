// THE closed list of rewarded ad placements - the only place a placement is ever
// defined. Adding a trigger point later = add one string here; the placement type,
// the runtime guard, and the analytics schema validation all follow automatically.
//
// Deliberately dependency-free (imported by analyticsSchema.ts, which the Worker
// bundles too - nothing browser- or Vite-specific may ever live here).

export const REWARDED_AD_PLACEMENTS = [
  /** Retry a failed daily challenge attempt. */
  "daily_retry",
  /** Retry a failed special challenge attempt. */
  "special_retry",
  /** Bonus/double reward on the daily chest. */
  "daily_chest_bonus",
  /** Bonus reward in a mega challenge. */
  "mega_challenge_bonus",
  /** Double a shop/coin reward. */
  "shop_double_reward",
  /** Double the coin reward on a regular shape challenge. */
  "shape_challenge_double_reward",
  /** Double the coin reward on a special challenge. */
  "special_challenge_double_reward",
  /** Double the coin reward on an Artist Pack challenge. */
  "artist_pack_double_reward",
  /** 0.58.0 Rewarded Ink Trial: the Classic Result's scheduled Ink slot (coin/ink rotation). */
  "shape_challenge_ink_trial",
  /** 0.58.0 Rewarded Ink Trial: Play Together's post-exit menu, after a completed session. */
  "play_together_ink_trial",
  /** 0.58.0 Rewarded Ink Trial: 2 Players' setup screen, after a completed game. */
  "two_players_ink_trial",
] as const;

export type RewardedAdPlacement = (typeof REWARDED_AD_PLACEMENTS)[number];

/**
 * 0.58.0: which AdMob rewarded ad UNIT a placement serves from. Two units, one lane (rewardedAds.ts): "ink" = the
 * Ink Trial offers (their own unit, so AdMob reports Coin and Ink apart); "coin" = every other placement, on the
 * long-standing production rewarded unit (unchanged ID, so its history continues).
 */
export type RewardedUnit = "coin" | "ink";
const INK_UNIT_PLACEMENTS: readonly RewardedAdPlacement[] = ["shape_challenge_ink_trial", "play_together_ink_trial", "two_players_ink_trial"];

export function rewardedUnitFor(placement: RewardedAdPlacement): RewardedUnit {
  return INK_UNIT_PLACEMENTS.includes(placement) ? "ink" : "coin";
}

export function isRewardedAdPlacement(value: unknown): value is RewardedAdPlacement {
  return typeof value === "string" && (REWARDED_AD_PLACEMENTS as readonly string[]).includes(value);
}
