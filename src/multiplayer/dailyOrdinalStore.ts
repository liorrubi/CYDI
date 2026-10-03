/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// "Which multiplayer game of the day is this?" - the one number mp_game_started
// carries as `mpDailyOrdinal`, so retention-by-depth can be read without any new
// event, request, Durable Object write or identifier.
//
// Local-only and deliberately tiny: the LOCAL calendar day, how many genuine games
// this device has started on it, and the key of the last one counted. It lives in its
// own localStorage key (not saveStore), fails silent like resumeStore.ts, and is never
// sent anywhere: only the capped ordinal leaves the device, on the existing event.
//
// Idempotence. A game is identified by `roomCode:gameSerial` (the room's Durable Object
// bumps gameSerial once per Start, so a rematch is a new game and a remount, a
// reconnect or a resume is the same one). Seeing the key that was counted last again
// returns null: the caller then omits the field, and the event still fires exactly as
// it did before. The key is kept here only to compare; it is never put on the wire.
//
// The local day, not Asia/Jerusalem and not UTC: "today" is the player's own day.
// A new local day resets the count.
const ORDINAL_KEY = "cydi.mp.dailyOrdinal.v1";

/** 7 means "7 or more" - the wire value is min(count, 7). */
export const MP_DAILY_ORDINAL_CAP = 7;

type DailyOrdinalState = { day: string; count: number; lastKey: string };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_KEY_LENGTH = 64;

/** The device's local calendar day as YYYY-MM-DD. */
export function localDayKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The identity of one game, local comparison only. */
export function multiplayerGameKey(roomCode: string, gameSerial: unknown): string {
  return `${roomCode}:${typeof gameSerial === "number" && Number.isFinite(gameSerial) ? gameSerial : "?"}`;
}

/** Stored state, or null when there is none or it is corrupt. Storage ACCESS errors propagate (the caller then sends nothing). */
function readState(): DailyOrdinalState | null {
  const raw = localStorage.getItem(ORDINAL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DailyOrdinalState> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.day !== "string" || !DAY_PATTERN.test(parsed.day)) return null;
    if (typeof parsed.count !== "number" || !Number.isInteger(parsed.count) || parsed.count < 0) return null;
    if (typeof parsed.lastKey !== "string" || parsed.lastKey.length > MAX_KEY_LENGTH) return null;
    return { day: parsed.day, count: Math.min(parsed.count, MP_DAILY_ORDINAL_CAP), lastKey: parsed.lastKey };
  } catch {
    return null;
  }
}

/**
 * Counts one genuine multiplayer game and returns its capped daily ordinal (1..7), or
 * null when nothing should be sent: the game was already counted, or storage is
 * unavailable (a count that cannot be kept would only ever say "1").
 */
export function recordMultiplayerGame(gameKey: string, now: Date = new Date()): number | null {
  try {
    if (!gameKey || gameKey.length > MAX_KEY_LENGTH) return null;
    const stored = readState();
    if (stored && stored.lastKey === gameKey) return null;
    const today = localDayKey(now);
    const previous = stored && stored.day === today ? stored.count : 0;
    const count = Math.min(previous + 1, MP_DAILY_ORDINAL_CAP);
    localStorage.setItem(ORDINAL_KEY, JSON.stringify({ day: today, count, lastKey: gameKey } satisfies DailyOrdinalState));
    return count;
  } catch {
    return null;
  }
}
