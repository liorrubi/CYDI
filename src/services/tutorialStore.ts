import { getSaveData, updateSaveData } from "./saveStore";

const ROUND_COMPLETED_EVENT = "cydi:round-completed";

// Round 2, not round 1: the first result screen belongs to the first-round coach
// ("Tap Next") and must not compete with a spotlight overlay on top of it.
export const ACHIEVEMENTS_TUTORIAL_ROUND_THRESHOLD = 2;

function getCompletedRoundCount(): number {
  return getSaveData().progress.completedRounds;
}

/** Records that the player finished a shape-challenge round (drawn + scored, pass or fail) and notifies listeners. */
export function recordRoundCompleted(): void {
  updateSaveData((data) => {
    data.progress.completedRounds += 1;
  });
  // A replayed tutorial covers one round only - the one that just finished.
  tutorialReplayArmed = false;
  window.dispatchEvent(new Event(ROUND_COMPLETED_EVENT));
}

// --- First-round coach --------------------------------------------------------
// The inline, non-blocking hints of the first Shape Challenge round (preview
// countdown, "Draw it", "Tap Done", "Tap Next"). Session-only state: a genuinely
// new player gets them via completedRounds === 0, and "Start Tutorial" in
// Instructions re-arms them once for veterans without touching persisted flags.

let tutorialReplayArmed = false;

/** Arms one full round of first-round coach hints (Instructions -> Start Tutorial). Not persisted. */
export function armTutorialReplay(): void {
  tutorialReplayArmed = true;
}

export function shouldShowFirstRoundCoach(): boolean {
  return tutorialReplayArmed || getSaveData().progress.completedRounds === 0;
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
 * Whether the achievements coach-mark is still owed, regardless of whether this
 * round is the one that fires it. The "First Steps" banner defers to it, and that
 * deferral must hold from the very first round - not only on the round the
 * threshold is reached - or the first result screen gets a full-screen
 * celebration card on top of the first-round coach.
 */
export function isAchievementsTutorialPending(): boolean {
  return !hasShownAchievementsTutorial();
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

export function markDrawingTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.drawingTutorialShown = true;
  });
}

/** Same "genuinely new player" guard as the onboarding tutorial: `completedRounds === 0` keeps this from firing for veterans whose older saves predate the `drawingTutorialShown` field. */
export function shouldShowDrawingTutorial(): boolean {
  const progress = getSaveData().progress;
  return !progress.drawingTutorialShown && progress.completedRounds === 0;
}

export function shouldShowMyChallengesTutorial(): boolean {
  return !getSaveData().progress.myChallengesTutorialShown;
}

export function markMyChallengesTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.myChallengesTutorialShown = true;
  });
}

/**
 * The one-time explainer on the ×2 coins offer. Deliberately a SINGLE global flag
 * rather than one per reward type: every entry point (shape / special / mega /
 * artist challenge, and the chest) renders the same DoubleCoinsOffer with the same
 * button, so explaining it once covers all of them.
 *
 * Unlike the onboarding tutorials there is no `completedRounds === 0` guard - an
 * existing player who has never met the offer should still get the explanation the
 * first time they do.
 */
export function shouldShowDoubleRewardTutorial(): boolean {
  return !getSaveData().progress.doubleRewardTutorialShown;
}

export function markDoubleRewardTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.doubleRewardTutorialShown = true;
  });
}

/**
 * One-time callout on the result screen pointing at the action that continues the
 * game. Separate from the ×2 explainer: that one teaches an optional bonus, this one
 * teaches how to move forward at all, so a player who only ever meets one of them
 * still gets the right lesson.
 */
export function shouldShowResultActionsTutorial(): boolean {
  return !getSaveData().progress.resultActionsTutorialShown;
}

export function markResultActionsTutorialShown(): void {
  updateSaveData((data) => {
    data.progress.resultActionsTutorialShown = true;
  });
}

// --- Create Challenge feature discovery ------------------------------------------
// Players who enter through Shape Challenge never pass the home screen again - the
// map -> play -> result -> next loop is closed - so the Create Challenge card is
// effectively invisible to them. These helpers surface it once in the result screen,
// with a single follow-up if it was ignored, and then never again.

export const CREATE_DISCOVERY_FIRST_ROUNDS = 3;
export const CREATE_DISCOVERY_REMINDER_ROUNDS = 8;

export type CreateDiscoveryVariant = "first" | "reminder";

/**
 * Which discovery prompt (if any) this result screen should offer.
 *
 * Returns null the moment the player is known to have found the feature: they have
 * already created a challenge (which also covers veterans from before these flags
 * existed), or they have opened the Create screen by ANY route - including the home
 * card, and including abandoning it without saving. Knowing the feature exists is the
 * bar here, not using it.
 */
export function createDiscoveryVariant(): CreateDiscoveryVariant | null {
  const progress = getSaveData().progress;
  if (progress.challenges.length > 0) return null;
  if (progress.createFeatureDiscovered) return null;
  const rounds = progress.completedRounds;
  if (!progress.createDiscoveryShown) return rounds >= CREATE_DISCOVERY_FIRST_ROUNDS ? "first" : null;
  if (!progress.createDiscoveryReminderShown) return rounds >= CREATE_DISCOVERY_REMINDER_ROUNDS ? "reminder" : null;
  return null;
}

/** Marked ONLY when the prompt actually rendered - a prompt deferred because another tutorial owned the screen is not burned. */
export function markCreateDiscoveryShown(variant: CreateDiscoveryVariant): void {
  updateSaveData((data) => {
    if (variant === "first") data.progress.createDiscoveryShown = true;
    else data.progress.createDiscoveryReminderShown = true;
  });
}

/** The player reached the Create screen - stop offering discovery prompts for good. */
export function markCreateFeatureDiscovered(): void {
  updateSaveData((data) => {
    data.progress.createFeatureDiscovered = true;
  });
}
