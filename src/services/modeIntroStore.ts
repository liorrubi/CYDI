/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The one-off "there are three ways to play" card.
//
// Its own key rather than a new SaveData field: SaveData is the progression and
// economy record, it carries a schema version, and adding a boolean to it to
// remember that somebody read a card is a migration in exchange for nothing.
// Same reasoning as multiplayerTutorialStore, and the same failure mode - a
// player with storage disabled sees the card again next session, which is the
// kinder way to be wrong about a two-sentence intro.
const MODE_INTRO_KEY = "cydi.tutorial.modeIntro.v1";

export function shouldShowModeIntro(): boolean {
  try {
    return localStorage.getItem(MODE_INTRO_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markModeIntroShown(): void {
  try {
    localStorage.setItem(MODE_INTRO_KEY, "1");
  } catch {
    // Best effort only - never block getting into the game over a flag.
  }
}

/** Re-arms the card. Wired to the existing "Start Tutorial" replay in Instructions. */
export function resetModeIntro(): void {
  try {
    localStorage.removeItem(MODE_INTRO_KEY);
  } catch {
    // Nothing to reset if storage is unavailable.
  }
}
