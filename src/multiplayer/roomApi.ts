/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The two plain-HTTP calls Play Together needs before a socket exists:
// allocating a room, and checking one before trying to join it.
//
// Both go through apiFetch, which is the only thing that knows how to reach the
// Worker from inside the Capacitor WebView (whose page origin is the virtual
// https://localhost, where a relative fetch would resolve to nothing and an
// absolute one is CORS-blocked). See services/nativeApi.ts.
import { apiFetch } from "../services/nativeApi";
import { isRoomCode, type RoomPhase } from "./protocol";

const REQUEST_TIMEOUT_MS = 10_000;

export type RoomInfo = {
  roomCode: string;
  phase: RoomPhase;
  players: number;
  maxPlayers: number;
  /** False once the game has started or the room is full - checked before opening a socket, so a doomed join fails with a clear message instead of a silent disconnect. */
  joinable: boolean;
  serverNow: number;
};

export type CreateRoomResult = { ok: true; roomCode: string } | { ok: false; error: string };

export async function createRoom(): Promise<CreateRoomResult> {
  try {
    const response = await apiFetch("/api/room", { method: "POST", timeoutMs: REQUEST_TIMEOUT_MS });
    if (!response.ok) return { ok: false, error: "Couldn't create a room. Please try again." };
    const body = (await response.json()) as { roomCode?: unknown };
    if (!isRoomCode(body.roomCode)) return { ok: false, error: "The server sent back an unusable room code." };
    return { ok: true, roomCode: body.roomCode };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export type LookupResult = { ok: true; info: RoomInfo } | { ok: false; error: string };

/** Existence and joinability check for a code someone typed or scanned. */
export async function lookupRoom(roomCode: string): Promise<LookupResult> {
  if (!isRoomCode(roomCode)) return { ok: false, error: "That doesn't look like a room code." };
  try {
    const response = await apiFetch(`/api/room/${roomCode}/info`, { timeoutMs: REQUEST_TIMEOUT_MS });
    if (response.status === 404) {
      return { ok: false, error: `No game found with code ${roomCode}. Check the code and try again.` };
    }
    if (!response.ok) return { ok: false, error: "Couldn't check that room. Please try again." };
    const info = (await response.json()) as RoomInfo;
    return { ok: true, info };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Human-readable reason a joinable=false room cannot be entered. */
export function joinBlockedReason(info: RoomInfo): string | null {
  if (info.joinable) return null;
  if (info.players >= info.maxPlayers) return `That game is full (${info.maxPlayers} players).`;
  return "That game has already started. Ask the host to start a new one.";
}
