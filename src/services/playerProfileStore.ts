const PLAYER_ID_KEY = "cydi.playerId.v1";
const PLAYER_NAME_KEY = "cydi.playerName.v1";
const MAX_NAME_LENGTH = 24;

export const ANONYMOUS_PLAYER_NAME = "Anonymous Player";

/**
 * Anonymous per-device identity, created once and reused forever. This is the
 * same id future login would attach to a real account - only the *source*
 * changes later (server-issued instead of locally generated), every daily
 * challenge record keyed by it stays valid.
 */
export function getPlayerId(): string {
  let id: string | null;
  try {
    id = localStorage.getItem(PLAYER_ID_KEY);
  } catch {
    id = null;
  }
  if (id) return id;

  id = crypto.randomUUID();
  try {
    localStorage.setItem(PLAYER_ID_KEY, id);
  } catch {
    // Storage unavailable - the id still works for this session, just won't persist.
  }
  return id;
}

export function getPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  try {
    if (trimmed) localStorage.setItem(PLAYER_NAME_KEY, trimmed);
    else localStorage.removeItem(PLAYER_NAME_KEY);
  } catch {
    // Best-effort only.
  }
}

/**
 * The name to submit/display for the current player - falls back to the anonymous
 * label whenever no name has been set. Same forward-compatibility note as
 * getPlayerId(): once login exists, the registered username takes over as the
 * source here, but every caller keeps working unchanged.
 */
export function getDisplayName(): string {
  return getPlayerName() || ANONYMOUS_PLAYER_NAME;
}
