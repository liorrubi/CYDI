/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The breadcrumb that lets CYDI offer "Return to Game" after the app is closed.
//
// Deliberately tiny: a room code and when it was noted, nothing else. The seat
// itself is already recoverable - `cydi.mp.token.<CODE>` holds the rejoin token
// the server issued - so this only answers "was this device in the middle of
// something", which the token alone cannot say (a token lingers after a game
// has finished perfectly normally).
//
// It is a HINT, never a source of truth. Home validates it against the room
// before showing anything, so a finished, abandoned or expired room produces no
// banner rather than a dead one.
//
// No `beforeunload`: it is unreliable on mobile, and correctness here does not
// depend on catching the moment of departure. The breadcrumb is written when a
// game starts and removed when the player deliberately leaves.
const RESUME_KEY = "cydi.mp.resume.v1";

/** How long a breadcrumb is worth acting on. Comfortably past the server's 30-minute idle TTL, so the room decides, not the clock here. */
const RESUME_TTL_MS = 60 * 60_000;

export type ResumeHint = { roomCode: string; savedAt: number };

export function rememberActiveRoom(roomCode: string): void {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ roomCode, savedAt: Date.now() } satisfies ResumeHint));
  } catch {
    // Storage unavailable: the player simply is not offered a resume.
  }
}

export function getActiveRoomHint(): ResumeHint | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumeHint> | null;
    if (!parsed || typeof parsed.roomCode !== "string" || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > RESUME_TTL_MS) return null;
    return { roomCode: parsed.roomCode, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/** Called on a deliberate Leave, and whenever the room turns out to be over. */
export function clearActiveRoom(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing to clear.
  }
}
