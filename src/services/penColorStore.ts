import { DEFAULT_PEN_COLOR, PEN_COLORS, type PenColorId } from "../app/constants";
import { getCoins } from "./coinsStore";
import { getSaveData, updateSaveData } from "./saveStore";

function readUnlocked(): PenColorId[] {
  return getSaveData().progress.unlockedPenColors;
}

export function getUnlockedColors(): PenColorId[] {
  const unlocked = readUnlocked();
  return unlocked.includes(DEFAULT_PEN_COLOR) ? unlocked : [DEFAULT_PEN_COLOR, ...unlocked];
}

export function isColorUnlocked(id: PenColorId): boolean {
  return getUnlockedColors().includes(id);
}

export function unlockColor(id: PenColorId): void {
  const current = getUnlockedColors();
  if (current.includes(id)) return;
  updateSaveData((data) => {
    data.progress.unlockedPenColors = [...current, id];
  });
}

export function getSelectedColor(): PenColorId {
  const selected = getSaveData().settings.selectedPenColor;
  if (selected && isColorUnlocked(selected)) return selected;
  return DEFAULT_PEN_COLOR;
}

export function setSelectedColor(id: PenColorId): void {
  updateSaveData((data) => {
    data.settings.selectedPenColor = id;
  });
}

/** True when the player can already afford at least one shop product (pen color) they haven't unlocked yet - drives the "you can afford something new" badge on the shop icon. */
export function hasAffordableUnpurchasedProduct(): boolean {
  const coins = getCoins();
  const unlocked = getUnlockedColors();
  return PEN_COLORS.some((color) => color.id !== DEFAULT_PEN_COLOR && !unlocked.includes(color.id) && coins >= (color.price ?? 0));
}
