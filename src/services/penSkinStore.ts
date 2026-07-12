import { DEFAULT_PEN_SKIN, PEN_SKINS, type PenSkinId } from "../app/constants";
import { getCoins } from "./coinsStore";
import { getSaveData, updateSaveData } from "./saveStore";
import { isUnlockEverythingActive } from "./unlockOverrideStore";

// Older save blobs (created before Drawing Pens shipped) have no
// unlockedPenSkins / selectedPenSkin fields, so every read tolerates them
// being absent - the free default pencil is always owned and equipped.
function readUnlocked(): PenSkinId[] {
  return getSaveData().progress.unlockedPenSkins ?? [];
}

/** Every pen skin the player can currently equip - all of them, unpurchased included, while the Settings "lock management" override is active. */
export function getUnlockedSkins(): PenSkinId[] {
  if (isUnlockEverythingActive()) return PEN_SKINS.map((skin) => skin.id);
  const unlocked = readUnlocked();
  return unlocked.includes(DEFAULT_PEN_SKIN) ? unlocked : [DEFAULT_PEN_SKIN, ...unlocked];
}

export function isSkinUnlocked(id: PenSkinId): boolean {
  return getUnlockedSkins().includes(id);
}

export function unlockSkin(id: PenSkinId): void {
  const current = getUnlockedSkins();
  if (current.includes(id)) return;
  updateSaveData((data) => {
    data.progress.unlockedPenSkins = [...(data.progress.unlockedPenSkins ?? []), id];
  });
}

export function getSelectedSkin(): PenSkinId {
  const selected = getSaveData().settings.selectedPenSkin;
  if (selected && isSkinUnlocked(selected)) return selected;
  return DEFAULT_PEN_SKIN;
}

export function setSelectedSkin(id: PenSkinId): void {
  updateSaveData((data) => {
    data.settings.selectedPenSkin = id;
  });
}

/** True when the player can afford at least one pen skin they don't own yet - feeds the shop icon's "something new is affordable" badge alongside pen colors. */
export function hasAffordableUnpurchasedSkin(): boolean {
  const coins = getCoins();
  const unlocked = getUnlockedSkins();
  return PEN_SKINS.some((skin) => skin.id !== DEFAULT_PEN_SKIN && !unlocked.includes(skin.id) && coins >= (skin.price ?? 0));
}
