// 0.59.0: the Drawing Streak celebration card (components/StreakCelebration.tsx) covers the screen it opens over -
// typically a result with a Rewarded offer on it. An offer must not count as SHOWN (reward_offer_shown, the cadence /
// rotation / interstitial-lane commit) while it is hidden. The card is marked open in the same tick as the paying
// event, before the result screen renders its offer, and every offer waits here until it is closed.

let cardOpen = false;
const waiters = new Set<() => void>();

/** A celebration card is about to cover the screen. */
export function openStreakCard(): void {
  cardOpen = true;
}

/** The card was closed: everything that waited for it runs now, once. */
export function closeStreakCard(): void {
  cardOpen = false;
  const ready = [...waiters];
  waiters.clear();
  for (const fn of ready) fn();
}

export function isStreakCardOpen(): boolean {
  return cardOpen;
}

/**
 * Runs `fn` now, or - while a celebration card covers the screen - once it is closed. Returns a cancel function: call
 * it on unmount, so an offer that never became visible never reports itself as shown.
 */
export function whenStreakCardClosed(fn: () => void): () => void {
  if (!cardOpen) {
    fn();
    return () => {};
  }
  waiters.add(fn);
  return () => {
    waiters.delete(fn);
  };
}
