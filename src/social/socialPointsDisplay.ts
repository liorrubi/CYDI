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

/**
 * The held value, and the rank band it should be READ IN.
 *
 * The band matters as much as the number. During a promotion the card
 * deliberately holds the old band while its bar fills to 100%, and a badge that
 * derived the rank from the points alone would flip to the new name during that
 * hold - announcing the promotion before the card does, which is the same
 * spoiler by a smaller margin. Caught on a real device: the badge read
 * "Challenger" while the card still read "Rookie, 10 / 10".
 */
export type SocialPointsHold = { points: number; bandIndex: number | null };

let override: SocialPointsHold | null = null;
const listeners = new Set<(value: SocialPointsHold | null) => void>();

/** Pass null to release the hold and let the badge show the real stored total again. */
export function setSocialPointsOverride(value: number | null, bandIndex: number | null = null): void {
  const next = value === null ? null : { points: Math.max(0, Math.floor(value)), bandIndex };
  if (next?.points === override?.points && next?.bandIndex === override?.bandIndex) return;
  override = next;
  for (const listener of listeners) listener(override);
}

export function getSocialPointsOverride(): SocialPointsHold | null {
  return override;
}

export function subscribeSocialPointsOverride(listener: (value: SocialPointsHold | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test/support hook, and the safety net a screen calls on unmount so a hold can never outlive the card that set it. */
export function clearSocialPointsOverride(): void {
  setSocialPointsOverride(null);
}
