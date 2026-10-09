import { categoryUnlockPrice } from "../app/constants";
import { getCategories, type CategoryId } from "../content/contentRepository";
import { isUnlockEverythingActive } from "./unlockOverrideStore";
import { getSaveData, updateSaveData } from "./saveStore";

function firstCategoryId(): CategoryId {
  return getCategories()[0].id;
}

function readUnlocked(): CategoryId[] {
  return getSaveData().progress.unlockedCategories as CategoryId[];
}

/** The first category is always free; every other category must be purchased with coins - unless the lock management override is active. */
export function getUnlockedCategoryIds(): CategoryId[] {
  if (isUnlockEverythingActive()) return getCategories().map((category) => category.id);
  const unlocked = readUnlocked();
  const first = firstCategoryId();
  return unlocked.includes(first) ? unlocked : [first, ...unlocked];
}

export function isCategoryUnlocked(id: CategoryId): boolean {
  return getUnlockedCategoryIds().includes(id);
}

export function unlockCategory(id: CategoryId): void {
  const current = getUnlockedCategoryIds();
  if (current.includes(id)) return;
  updateSaveData((data) => {
    data.progress.unlockedCategories = [...current, id];
  });
}

/**
 * How many paid categories the player has BOUGHT - the one count both the price (0.59.0, by purchase order) and
 * the analytics purchase ordinal read. The saved list only: never the "unlock everything" override, and never a
 * category that is merely open because it was played under the pre-paywall rules (that one was never bought).
 */
export function getPaidCategoryPurchaseCount(): number {
  const first = getCategories()[0]?.id;
  return readUnlocked().filter((id) => id !== first).length;
}

/** What the next category costs right now: 1,000 / 1,250 / 1,500 for the 1st / 2nd / 3rd+ paid category. */
export function nextCategoryUnlockPrice(): number {
  return categoryUnlockPrice(getPaidCategoryPurchaseCount());
}
