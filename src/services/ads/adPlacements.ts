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
] as const;

export type RewardedAdPlacement = (typeof REWARDED_AD_PLACEMENTS)[number];

export function isRewardedAdPlacement(value: unknown): value is RewardedAdPlacement {
  return typeof value === "string" && (REWARDED_AD_PLACEMENTS as readonly string[]).includes(value);
}
