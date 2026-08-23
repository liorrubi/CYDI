/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// A single place for a screen to say "not yet" to the Android back button.
//
// The in-app back arrow is a prop the screen already owns, so it can ask its own
// question. The HARDWARE back button is not: it is handled once, in App.tsx,
// far away from whatever is on screen. Without somewhere to register, a live
// multiplayer game has no way to intervene before the room is left.
//
// One guard at a time, because only one screen is ever in front of the player.
// The guard returns true when it has taken responsibility - it has shown a
// confirmation, and back must do nothing else this press.
type Guard = () => boolean;

let guard: Guard | null = null;

/** Registers the guard for the screen currently in front. Returns the unregister function, so an effect can `return registerNavigationGuard(...)`. */
export function registerNavigationGuard(next: Guard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/** Returns true when a guard handled the press and navigation must stop. */
export function runNavigationGuard(): boolean {
  if (!guard) return false;
  try {
    return guard();
  } catch {
    // A broken guard must never trap the player in a screen.
    return false;
  }
}

/** Test hook. */
export function clearNavigationGuard(): void {
  guard = null;
}
