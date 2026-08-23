/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Play Together's own first-run flags.
//
// Deliberately NOT part of SaveData / tutorialStore, for two reasons:
//   1. Multiplayer must not touch progression state, and SaveData is exactly
//      that (coins, achievements, round counters, category unlocks). Keeping
//      these flags in their own keys makes the isolation structural rather
//      than a rule someone has to remember.
//   2. A long-time CYDI player has already dismissed every existing tutorial.
//      Reusing those flags would mean the person most likely to host a game is
//      the one person who never gets told how it works.
//
// Host and guest are tracked separately: they are shown different things (only
// the host has controls), and being a guest once should not silently consume
// the explanation you need the first time you host.
const HOST_TUTORIAL_KEY = "cydi.mp.tutorial.host.v1";
const GUEST_TUTORIAL_KEY = "cydi.mp.tutorial.guest.v1";
const ROUND_COACH_KEY = "cydi.mp.coach.round.v1";
// Pass & Play is a different game with a different explanation (one device,
// taken in turns), so it gets its own flag rather than reusing the guest one.
const PASS_PLAY_TUTORIAL_KEY = "cydi.mp.tutorial.passplay.v1";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // Private mode / storage disabled. Treating it as "already shown" would
    // hide the tutorial forever; treating it as "not shown" means it reappears
    // each session, which is the kinder failure for a first-time player.
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Best effort only - never break a game over a tutorial flag.
  }
}

export function shouldShowHostTutorial(): boolean {
  return !readFlag(HOST_TUTORIAL_KEY);
}

export function markHostTutorialShown(): void {
  writeFlag(HOST_TUTORIAL_KEY);
}

export function shouldShowGuestTutorial(): boolean {
  return !readFlag(GUEST_TUTORIAL_KEY);
}

export function markGuestTutorialShown(): void {
  writeFlag(GUEST_TUTORIAL_KEY);
}

export function shouldShowPassPlayTutorial(): boolean {
  return !readFlag(PASS_PLAY_TUTORIAL_KEY);
}

export function markPassPlayTutorialShown(): void {
  writeFlag(PASS_PLAY_TUTORIAL_KEY);
}

/** The in-round coach marks ("Remember this shape!", "Draw it from memory!", ...) - shown through the first round only, once ever. */
export function shouldShowRoundCoach(): boolean {
  return !readFlag(ROUND_COACH_KEY);
}

export function markRoundCoachShown(): void {
  writeFlag(ROUND_COACH_KEY);
}

/** Test/support hook: re-arms every Play Together tutorial. */
export function resetMultiplayerTutorials(): void {
  try {
    localStorage.removeItem(HOST_TUTORIAL_KEY);
    localStorage.removeItem(GUEST_TUTORIAL_KEY);
    localStorage.removeItem(ROUND_COACH_KEY);
    localStorage.removeItem(PASS_PLAY_TUTORIAL_KEY);
  } catch {
    // Nothing to reset if storage is unavailable.
  }
}
