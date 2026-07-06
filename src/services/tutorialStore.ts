const ROUND_COUNT_KEY = "cydi.completedRounds.v1";
const TUTORIAL_SHOWN_KEY = "cydi.achievementsTutorialShown.v1";
const ROUND_COMPLETED_EVENT = "cydi:round-completed";

export const ACHIEVEMENTS_TUTORIAL_ROUND_THRESHOLD = 2;

function getCompletedRoundCount(): number {
  try {
    const raw = localStorage.getItem(ROUND_COUNT_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Records that the player finished a shape-challenge round (drawn + scored, pass or fail) and notifies listeners. */
export function recordRoundCompleted(): void {
  try {
    localStorage.setItem(ROUND_COUNT_KEY, String(getCompletedRoundCount() + 1));
  } catch (error) {
    console.warn("Failed to persist completed round count", error);
  }
  window.dispatchEvent(new Event(ROUND_COMPLETED_EVENT));
}

export function onRoundCompleted(listener: () => void): () => void {
  window.addEventListener(ROUND_COMPLETED_EVENT, listener);
  return () => window.removeEventListener(ROUND_COMPLETED_EVENT, listener);
}

function hasShownAchievementsTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAchievementsTutorialShown(): void {
  try {
    localStorage.setItem(TUTORIAL_SHOWN_KEY, "1");
  } catch (error) {
    console.warn("Failed to persist achievements tutorial state", error);
  }
}

export function shouldShowAchievementsTutorial(): boolean {
  return !hasShownAchievementsTutorial() && getCompletedRoundCount() >= ACHIEVEMENTS_TUTORIAL_ROUND_THRESHOLD;
}
