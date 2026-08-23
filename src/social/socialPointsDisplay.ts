/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// A display-only hold on the Social Points total.
//
// The stored total is the truth and is written the instant a match is scored.
// The problem that creates is purely presentational: the compact badge in the
// header subscribes to the store, so it would flip to "Challenger · 10" while
// the champion reveal is still playing - announcing the promotion before the
// progress card has even mounted, let alone counted up to it.
//
// So the badge renders an OVERRIDE when one is set, and the progress card owns
// that override: pinned to the pre-match total at the moment of the award, then
// driven frame by frame as the card counts up, then released. The badge and the
// card therefore always agree, and the rank reveal happens once, in the place
// designed for it.
//
// Deliberately separate from socialPointsStore: nothing here is persisted, and
// the store must not grow a notion of "what is currently on screen".

let override: number | null = null;
const listeners = new Set<(value: number | null) => void>();

/** Pass null to release the hold and let the badge show the real stored total again. */
export function setSocialPointsOverride(value: number | null): void {
  const next = value === null ? null : Math.max(0, Math.floor(value));
  if (next === override) return;
  override = next;
  for (const listener of listeners) listener(override);
}

export function getSocialPointsOverride(): number | null {
  return override;
}

export function subscribeSocialPointsOverride(listener: (value: number | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test/support hook, and the safety net a screen calls on unmount so a hold can never outlive the card that set it. */
export function clearSocialPointsOverride(): void {
  setSocialPointsOverride(null);
}
