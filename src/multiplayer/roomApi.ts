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
import { multiplayerVersionQuery } from "./clientVersionParams";
import { MP_UPDATE_REQUIRED_CODE, MP_UPDATE_REQUIRED_STATUS } from "./versionGate";

/** Mirrors GUARD_REJECTION_STATUS / GUARD_REJECTION_CODE in worker/multiplayerGuard.ts (not imported: the Worker module is not client code). */
const CAPACITY_STATUS = 503;
export const MP_CAPACITY_CODE = "multiplayer_capacity";

/** Why a room call failed, when the server said so specifically. The UI reacts differently to each. */
export type RoomErrorCode = typeof MP_CAPACITY_CODE | typeof MP_UPDATE_REQUIRED_CODE;

export const CAPACITY_MESSAGE = "Play Together is busy right now. Solo play is unaffected - please try again in a little while.";
export const UPDATE_REQUIRED_MESSAGE = "This version of CYDI is too old for Play Together. Update the app to keep playing with friends.";

/**
 * Reads a refusal the server made on purpose. The status AND the body code must agree,
 * so an unrelated 503 (a platform hiccup) is not mistaken for a capacity decision.
 */
async function refusalCode(response: { status: number; json(): Promise<unknown> }): Promise<RoomErrorCode | null> {
  if (response.status !== CAPACITY_STATUS && response.status !== MP_UPDATE_REQUIRED_STATUS) return null;
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    if (response.status === CAPACITY_STATUS && body?.code === MP_CAPACITY_CODE) return MP_CAPACITY_CODE;
    if (response.status === MP_UPDATE_REQUIRED_STATUS && body?.code === MP_UPDATE_REQUIRED_CODE) return MP_UPDATE_REQUIRED_CODE;
  } catch {
    // not a refusal body
  }
  return null;
}

function refusalMessage(code: RoomErrorCode): string {
  return code === MP_CAPACITY_CODE ? CAPACITY_MESSAGE : UPDATE_REQUIRED_MESSAGE;
}

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

export type CreateRoomResult = { ok: true; roomCode: string } | { ok: false; error: string; code?: RoomErrorCode };

export async function createRoom(): Promise<CreateRoomResult> {
  try {
    const response = await apiFetch(`/api/room?${multiplayerVersionQuery()}`, { method: "POST", timeoutMs: REQUEST_TIMEOUT_MS });
    if (!response.ok) {
      const code = await refusalCode(response);
      if (code) return { ok: false, error: refusalMessage(code), code };
      return { ok: false, error: "Couldn't create a room. Please try again." };
    }
    const body = (await response.json()) as { roomCode?: unknown };
    if (!isRoomCode(body.roomCode)) return { ok: false, error: "The server sent back an unusable room code." };
    return { ok: true, roomCode: body.roomCode };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export type LookupResult = { ok: true; info: RoomInfo } | { ok: false; error: string; code?: RoomErrorCode };

/** Existence and joinability check for a code someone typed or scanned. */
export async function lookupRoom(roomCode: string): Promise<LookupResult> {
  if (!isRoomCode(roomCode)) return { ok: false, error: "That doesn't look like a room code." };
  try {
    const response = await apiFetch(`/api/room/${roomCode}/info?${multiplayerVersionQuery()}`, { timeoutMs: REQUEST_TIMEOUT_MS });
    if (response.status === 404) {
      return { ok: false, error: `No game found with code ${roomCode}. Check the code and try again.` };
    }
    if (!response.ok) {
      const code = await refusalCode(response);
      if (code) return { ok: false, error: refusalMessage(code), code };
      return { ok: false, error: "Couldn't check that room. Please try again." };
    }
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
