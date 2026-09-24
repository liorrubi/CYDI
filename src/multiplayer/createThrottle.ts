// Play Together's Create button, protected against becoming the load it asks for.
//
// - Debounce: a second tap inside CREATE_DEBOUNCE_MS of the last attempt is ignored.
// - Capacity backoff: after the server's deliberate 503 multiplayer_capacity, Create
//   stays refused for a growing, bounded delay (15 s -> 30 s -> 60 s -> 120 s cap).
//   There is NO automatic retry: the player decides to try again once it allows.
// - Update required: sticky for the app run - no later tap can succeed.
//
// Module-level on purpose, so leaving the screen and coming back does not reset it.
// Pure apart from that one state object; the clock is passed in.

export const CREATE_DEBOUNCE_MS = 1_000;
export const CAPACITY_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000] as const;

type State = { lastAttemptAt: number; capacityRejections: number; blockedUntil: number; updateRequired: boolean };

const initial = (): State => ({ lastAttemptAt: -Infinity, capacityRejections: 0, blockedUntil: -Infinity, updateRequired: false });
let state: State = initial();

export type CreateGate =
  | { ok: true }
  | { ok: false; reason: "debounce" }
  | { ok: false; reason: "backoff"; waitMs: number }
  | { ok: false; reason: "update_required" };

export function checkCreateAllowed(now: number): CreateGate {
  if (state.updateRequired) return { ok: false, reason: "update_required" };
  if (now < state.blockedUntil) return { ok: false, reason: "backoff", waitMs: state.blockedUntil - now };
  if (now - state.lastAttemptAt < CREATE_DEBOUNCE_MS) return { ok: false, reason: "debounce" };
  return { ok: true };
}

export function recordCreateAttempt(now: number): void {
  state.lastAttemptAt = now;
}

/** `code` is the refusal the server made on purpose, if any; `ok` a room was created. */
export function recordCreateResult(now: number, result: { ok: boolean; code?: string }): void {
  if (result.ok) {
    state.capacityRejections = 0;
    state.blockedUntil = -Infinity;
    return;
  }
  if (result.code === "multiplayer_update_required") {
    state.updateRequired = true;
    return;
  }
  if (result.code === "multiplayer_capacity") {
    const delay = CAPACITY_BACKOFF_MS[Math.min(state.capacityRejections, CAPACITY_BACKOFF_MS.length - 1)];
    state.capacityRejections++;
    state.blockedUntil = now + delay;
  }
  // Any other failure (network, generic error) keeps only the debounce.
}

/** Joining someone else's room can also learn that this build is retired. */
export function recordUpdateRequired(): void {
  state.updateRequired = true;
}

export function isMultiplayerUpdateRequired(): boolean {
  return state.updateRequired;
}

export function _resetCreateThrottleForTests(): void {
  state = initial();
}
