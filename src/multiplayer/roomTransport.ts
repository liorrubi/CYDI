/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The seam between the Play Together UI and whatever is actually driving the
// room.
//
// The product implementation is roomSocket.ts, which speaks WebSocket to
// RoomDO. fakeRoom.ts implements the same interface entirely in memory and is
// used only by tests and local UI work.
//
// The seam exists so the screens never learn which one they are talking to:
// both emit exactly the ServerFrame values RoomDO emits, so swapping the fake
// for the real socket in Stage 5 changed no UI code at all.
import type { ClientFrame, ServerFrame } from "./protocol";

/**
 * Connection health, as the UI needs to describe it.
 *
 * "reconnecting" is the one that matters: on a phone the socket is far more
 * likely to go quiet than to close cleanly, and the player needs to be told
 * their game is still there rather than staring at a frozen screen.
 */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type RoomTransport = {
  send(frame: ClientFrame): void;
  /** Returns an unsubscribe function. A subscriber is replayed the latest snapshot immediately, so a late-mounting screen never waits for the next broadcast. */
  subscribe(listener: (frame: ServerFrame) => void): () => void;
  close(): void;
  /** Optional: the in-memory dev harness has no connection to report on. */
  subscribeStatus?(listener: (status: ConnectionStatus) => void): () => void;
};
