const UNLOCK_EVERYTHING_KEY = "cydi.allCategoriesUnlockedOverride.v1";

/** Whether the Settings "lock management" cheat toggle has forced every category and shape open, without erasing real purchases/progress underneath - those reassert themselves as soon as this is switched back off. */
export function isUnlockEverythingActive(): boolean {
  try {
    return localStorage.getItem(UNLOCK_EVERYTHING_KEY) === "1";
  } catch {
    return false;
  }
}

export function setUnlockEverything(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(UNLOCK_EVERYTHING_KEY, "1");
    } else {
      localStorage.removeItem(UNLOCK_EVERYTHING_KEY);
    }
  } catch (error) {
    console.warn("Failed to persist unlock-everything override", error);
  }
}
