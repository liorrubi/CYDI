// 0.59.0: the Drawing Streak celebration card (components/StreakCelebration.tsx) covers the screen it opens over -
// typically a result with a Rewarded offer on it. An offer must not count as SHOWN (reward_offer_shown, the cadence /
// rotation / interstitial-lane commit) while it is hidden. The card is marked open in the same tick as the paying
// event, before the result screen renders its offer, and every offer waits here until it is closed.
// Rewards earned on the SAME drawing (an achievement) join the open card as extra rows instead of a second overlay.

/** One more reward listed on the open card. */
export type StreakCardExtra = { id: string; title: string; coins: number };

let cardOpen = false;
const waiters = new Set<() => void>();
let extras: StreakCardExtra[] = [];
const extraListeners = new Set<() => void>();

/** A celebration card is about to cover the screen. */
export function openStreakCard(): void {
  cardOpen = true;
}

/** The card was closed: everything that waited for it runs now, once, and its extra rows are cleared. */
export function closeStreakCard(): void {
  cardOpen = false;
  extras = [];
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

/**
 * Lists rewards earned on the same drawing on the open card (one celebration, every reward). Returns false - and
 * changes nothing - when no card is open, so the caller shows its own feedback instead. The rewards themselves are
 * already paid by the caller; this is only how they are shown.
 */
export function addToStreakCard(items: StreakCardExtra[]): boolean {
  if (!cardOpen) return false;
  const known = new Set(extras.map((x) => x.id));
  extras = [...extras, ...items.filter((x) => !known.has(x.id))];
  for (const fn of [...extraListeners]) fn();
  return true;
}

export function getStreakCardExtras(): StreakCardExtra[] {
  return extras;
}

export function onStreakCardExtras(listener: () => void): () => void {
  extraListeners.add(listener);
  return () => {
    extraListeners.delete(listener);
  };
}
