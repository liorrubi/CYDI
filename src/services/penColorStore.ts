import { DEFAULT_PEN_COLOR, PEN_COLORS, type PenColorId } from "../app/constants";
import { getCoins } from "./coinsStore";

const UNLOCKED_KEY = "cydi.unlockedPenColors.v1";
const SELECTED_KEY = "cydi.selectedPenColor.v1";

function readUnlocked(): PenColorId[] {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  try {
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...current, id]));
  } catch (error) {
    console.warn("Failed to persist unlocked pen colors", error);
  }
}

export function getSelectedColor(): PenColorId {
  try {
    const raw = localStorage.getItem(SELECTED_KEY) as PenColorId | null;
    if (raw && isColorUnlocked(raw)) return raw;
    return DEFAULT_PEN_COLOR;
  } catch {
    return DEFAULT_PEN_COLOR;
  }
}

export function setSelectedColor(id: PenColorId): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch (error) {
    console.warn("Failed to persist selected pen color", error);
  }
}

/** True when the player can already afford at least one shop product (pen color) they haven't unlocked yet - drives the "you can afford something new" badge on the shop icon. */
export function hasAffordableUnpurchasedProduct(): boolean {
  const coins = getCoins();
  const unlocked = getUnlockedColors();
  return PEN_COLORS.some((color) => color.id !== DEFAULT_PEN_COLOR && !unlocked.includes(color.id) && coins >= (color.price ?? 0));
}
