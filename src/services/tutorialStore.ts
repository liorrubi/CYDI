import { getSaveData, updateSaveData } from "./saveStore";

const ROUND_COMPLETED_EVENT = "cydi:round-completed";

export const ACHIEVEMENTS_TUTORIAL_ROUND_THRESHOLD = 1;

function getCompletedRoundCount(): number {
  return getSaveData().progress.completedRounds;
}

/** Records that the player finished a shape-challenge round (drawn + scored, pass or fail) and notifies listeners. */
export function recordRoundCompleted(): void {
  updateSaveData((data) => {
    data.progress.completedRounds += 1;
  });
  window.dispatchEvent(new Event(ROUND_COMPLETED_EVENT));
}

export function onRoundCompleted(listener: () => void): () => void {
  window.addEventListener(ROUND_COMPLETED_EVENT, listener);
  return () => window.removeEventListener(ROUND_COMPLETED_EVENT, listener);
}

function hasShownAchievementsTutorial(): boolean {
  return getSaveData().progress.achievementsTutorialShown;
}

export function markAchievementsTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.achievementsTutorialShown = true;
  });
}

export function shouldShowAchievementsTutorial(): boolean {
  return !hasShownAchievementsTutorial() && getCompletedRoundCount() >= ACHIEVEMENTS_TUTORIAL_ROUND_THRESHOLD;
}

export function shouldShowMyChallengesTutorial(): boolean {
  return !getSaveData().progress.myChallengesTutorialShown;
}

export function markMyChallengesTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.myChallengesTutorialShown = true;
  });
}
