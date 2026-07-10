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

/**
 * The onboarding tutorial targets genuinely new players: never shown once dismissed, and the
 * `completedRounds === 0` guard keeps it from popping up for veterans whose older saves
 * predate the `onboardingTutorialShown` field.
 */
export function shouldShowOnboardingTutorial(): boolean {
  const progress = getSaveData().progress;
  return !progress.onboardingTutorialShown && progress.completedRounds === 0;
}

export function markOnboardingTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.onboardingTutorialShown = true;
  });
}

export function shouldShowMyChallengesTutorial(): boolean {
  return !getSaveData().progress.myChallengesTutorialShown;
}

export function markMyChallengesTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.myChallengesTutorialShown = true;
  });
}
