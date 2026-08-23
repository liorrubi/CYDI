/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Where Social Points live.
//
// Its own localStorage key, NOT SaveData. SaveData is progression-and-economy -
// coins, achievements, streaks, unlocks - and Social Points must not be able to
// interact with any of it: there is no shop, no spending, no ad that grants
// them, and no path by which earning one can move a coin balance. Keeping the
// two in separate keys makes that structural instead of a rule to remember.
//
// Not synced, not tied to a login, not tied to a room code or a nickname. It is
// a per-device tally, exactly like the rest of CYDI's local state.
//
// FORWARD ROOM: the stored record is versioned and the read path fills in
// defaults, so a later release can add a rank, badges, unlocked frames or
// confetti variants by extending `SocialProfile` without invalidating anyone's
// existing total. None of that is built here.
import { passPlayAwardId } from "../social/socialRewards";

const STORAGE_KEY = "cydi.social.v1";

/**
 * How many award ids are remembered for the anti-double-award check.
 *
 * Bounded because this list is the only thing in the record that grows. Sixty
 * is far more than the number of matches anyone plays between two page loads,
 * and the ids are only ever consulted for a match that just finished - an id
 * old enough to fall off the end belongs to a match that can no longer be on
 * screen to re-award itself.
 */
const MAX_REMEMBERED_AWARDS = 60;

export type SocialProfile = {
  total: number;
  /** Most recent last. Internal - callers ask `hasAwarded` rather than reading this. */
  awarded: string[];
};

const EMPTY: SocialProfile = { total: 0, awarded: [] };

type Listener = (profile: SocialProfile) => void;
const listeners = new Set<Listener>();

/** Read through `globalThis` at call time, never at module load: that is what lets a test install a storage before using the store, and what keeps SSR/private mode from throwing on import. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(): SocialProfile {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SocialProfile> | null;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return {
      // A corrupt or hand-edited total must not become NaN and poison every
      // later addition.
      total: Number.isFinite(parsed.total) ? Math.max(0, Math.floor(parsed.total as number)) : 0,
      awarded: Array.isArray(parsed.awarded) ? parsed.awarded.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(profile: SocialProfile): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...profile, awarded: profile.awarded.slice(-MAX_REMEMBERED_AWARDS) }));
  } catch {
    // Storage full or unavailable. The points are still correct for this
    // session; losing a tally is never worth breaking a game over.
  }
  for (const listener of listeners) listener(profile);
}

export function getSocialProfile(): SocialProfile {
  return read();
}

export function getSocialPoints(): number {
  return read().total;
}

export function hasAwarded(awardId: string): boolean {
  return read().awarded.includes(awardId);
}

export type AwardResult = {
  /** False when this exact award has already been paid, which is the normal case on a repeat. */
  granted: boolean;
  /** Points added by THIS call - 0 when it was a repeat. */
  points: number;
  total: number;
};

/**
 * Pays an award once, ever.
 *
 * Idempotency is keyed on `awardId` and nothing else, which is what makes every
 * way a completed match can be seen twice - a repeated final snapshot, a
 * reconnect, a React remount, a back/forward navigation, a duplicate event -
 * resolve to the same no-op. The caller does not need to know which of those
 * just happened.
 */
export function awardSocialPoints(awardId: string, points: number): AwardResult {
  const profile = read();
  if (!awardId || profile.awarded.includes(awardId)) {
    return { granted: false, points: 0, total: profile.total };
  }
  // Defensive, not expected: an award is a small positive integer, and a
  // negative one must never be able to spend a total that cannot be spent.
  const amount = Math.max(0, Math.floor(points));
  const next: SocialProfile = {
    total: profile.total + amount,
    awarded: [...profile.awarded, awardId].slice(-MAX_REMEMBERED_AWARDS),
  };
  write(next);
  return { granted: true, points: amount, total: next.total };
}

/** Convenience for the local mode, which has exactly one award per match. */
export function awardPassPlayMatch(gameId: string, points: number): AwardResult {
  return awardSocialPoints(passPlayAwardId(gameId), points);
}

/** Notifies the small header badges so a total updates the moment it changes, without prop-drilling through a game. */
export function subscribeSocialPoints(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test/support hook. */
export function resetSocialPoints(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to reset if storage is unavailable.
  }
  for (const listener of listeners) listener({ ...EMPTY });
}
