import { CATEGORIES, type CategoryId } from "../engine/shapeLibrary";
import { isUnlockEverythingActive } from "./unlockOverrideStore";
import { getSaveData, updateSaveData } from "./saveStore";

function firstCategoryId(): CategoryId {
  return CATEGORIES[0].id;
}

function readUnlocked(): CategoryId[] {
  return getSaveData().progress.unlockedCategories as CategoryId[];
}

/** The first category is always free; every other category must be purchased with coins - unless the lock management override is active. */
export function getUnlockedCategoryIds(): CategoryId[] {
  if (isUnlockEverythingActive()) return CATEGORIES.map((category) => category.id);
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
