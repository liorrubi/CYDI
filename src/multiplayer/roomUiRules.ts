/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The handful of decisions the Play Together UI makes from a snapshot, pulled
// out of the components so they can be asserted without mounting React.
//
// These are real rules, not test scaffolding: getting any of them wrong is a
// visible bug (drawing on a submitted canvas, a guest seeing a host button,
// the target shape on screen while it is supposed to be hidden), and each is a
// single boolean that is far easier to pin here than through the DOM.
import type { RoomPhase } from "./protocol";

/**
 * Whether the canvas accepts input.
 *
 * Three independent locks, all of which must be open:
 *   - the round must actually be in its drawing window;
 *   - the server must not already have this player's submission;
 *   - a submission must not be in flight (the local echo, so the canvas locks
 *     on the tap rather than on the round trip).
 */
export function canDrawNow(phase: RoomPhase, submitted: boolean, submitting: boolean): boolean {
  return phase === "DRAWING" && !submitted && !submitting;
}

/** Whether the reference shape may be on screen. True for exactly one phase - never during COUNTDOWN, and never while drawing. */
export function showsTargetShape(phase: RoomPhase): boolean {
  return phase === "SHOW_SHAPE";
}

/** The primary control for this player in this phase, or null when they have none and should be shown a waiting state instead. */
export function hostControlFor(phase: RoomPhase, isHost: boolean): "start" | "next" | "rematch" | null {
  if (!isHost) return null;
  if (phase === "LOBBY") return "start";
  if (phase === "ROUND_RESULTS") return "next";
  if (phase === "FINAL_RESULTS") return "rematch";
  return null;
}

/** Whether a non-host should be shown a "waiting for the host" message in this phase. */
export function showsWaitingForHost(phase: RoomPhase, isHost: boolean): boolean {
  if (isHost) return false;
  return phase === "LOBBY" || phase === "ROUND_RESULTS" || phase === "FINAL_RESULTS";
}

/** "Round 3 of 10", or an empty string before the first round has started. */
export function roundLabel(roundIndex: number, rounds: number): string {
  return roundIndex >= 0 ? `Round ${roundIndex + 1} of ${rounds}` : "";
}
