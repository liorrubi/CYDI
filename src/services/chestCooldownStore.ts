import { CHEST_PURCHASE_COOLDOWN_MS, type ChestTierId } from "../app/constants";
import { getSaveData, updateSaveData } from "./saveStore";

/** Saves written before per-tier purchase cooldowns shipped have no `shopChestCooldowns` field at all (loading doesn't merge in new defaults), so every read/write normalizes with a fallback. */
export function chestCooldownEndsAt(tierId: ChestTierId): number {
  return (getSaveData().progress.shopChestCooldowns ?? {})[tierId] ?? 0;
}

/** Milliseconds until `tierId` can be bought again; 0 if already available. */
export function msUntilChestAvailable(tierId: ChestTierId): number {
  return Math.max(0, chestCooldownEndsAt(tierId) - Date.now());
}

export function isChestOnCooldown(tierId: ChestTierId): boolean {
  return msUntilChestAvailable(tierId) > 0;
}

/** Locks `tierId` out for `CHEST_PURCHASE_COOLDOWN_MS`. Call this at the moment of a successful purchase, other tiers are untouched. */
export function startChestCooldown(tierId: ChestTierId): void {
  updateSaveData((data) => {
    const cooldowns = data.progress.shopChestCooldowns ?? {};
    cooldowns[tierId] = Date.now() + CHEST_PURCHASE_COOLDOWN_MS;
    data.progress.shopChestCooldowns = cooldowns;
  });
}
