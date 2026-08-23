/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The real Play Together transport: a WebSocket to RoomDO.
//
// Slots into the same RoomTransport seam the Stage 4 fake used, so none of the
// UI changed when this replaced it.
//
// Three things this has to get right, all of them learned the hard way:
//
// 1. WEBSOCKETS WORK FROM THE CAPACITOR WEBVIEW, plain fetch does not. The
//    WebView serves the app from the virtual origin https://localhost, and a
//    cross-origin fetch from there is CORS-blocked (which is why
//    services/nativeApi.ts exists). WebSockets are not subject to CORS, and
//    this was measured end-to-end on a real device before any of it was built.
//    So the URL here is absolute, against getApiOrigin(), never relative.
//
// 2. A BACKGROUNDED WEBVIEW FREEZES RATHER THAN DISCONNECTING. On a real
//    phone the socket survived 40 seconds in the background and resumed fine -
//    what stops is JavaScript, not the connection. The common failure is
//    therefore a live socket owned by a client whose view of the world is
//    stale, not a dropped one. That is why every recovery path re-syncs from a
//    full snapshot and never tries to replay the phases it missed.
//
// 3. DEVICE CLOCKS ARE WRONG. The test phone sat 1.4 seconds off the server.
//    Nothing here ever sends or trusts a client timestamp as authority; the
//    clock offset measured in useRoom is for RENDERING deadlines only.
import { getApiWebSocketOrigin } from "../services/nativeApi";
import { getPlayerId } from "../services/playerProfileStore";
import type { ClientFrame, ServerFrame } from "./protocol";
import type { ConnectionStatus, RoomTransport } from "./roomTransport";

/** Reconnect backoff: quick first retries for a blip, settling to a slow poll so a long outage does not hammer the edge. */
const BACKOFF_MS = [400, 800, 1600, 3200, 6400, 10_000, 15_000];
/** Random 0-30% added to each delay so eight players kicked off together do not all retry in lockstep. */
const BACKOFF_JITTER = 0.3;

/** Nothing heard from the server for this long (while visible) triggers a liveness ping. */
const SILENCE_BEFORE_PROBE_MS = 20_000;
/** A probe unanswered for this long means the socket is dead even though it looks open. */
const PROBE_TIMEOUT_MS = 5_000;
/** Faster probe deadline when returning from the background, where the player is waiting on the screen. */
const RESUME_PROBE_TIMEOUT_MS = 3_000;
const WATCHDOG_INTERVAL_MS = 5_000;

function tokenKey(roomCode: string): string {
  return `cydi.mp.token.${roomCode}`;
}

/**
 * The seat credential for a room, kept so a reload or a dropped connection can
 * reclaim the same seat and score. Scoped per room code and cleared when the
 * player leaves deliberately.
 */
function readToken(roomCode: string): string | null {
  try {
    return localStorage.getItem(tokenKey(roomCode));
  } catch {
    return null;
  }
}

function writeToken(roomCode: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(roomCode), token);
  } catch {
    // Storage unavailable: the token still works for this connection, it just
    // will not survive a reload.
  }
}

/** Whether a seat credential is held for this room - i.e. whether a join would be a reconnect rather than a new player. */
export function hasRoomToken(roomCode: string): boolean {
  return readToken(roomCode) !== null;
}

export function clearRoomToken(roomCode: string): void {
  try {
    localStorage.removeItem(tokenKey(roomCode));
  } catch {
    // Nothing to clear.
  }
}

export function roomSocketUrl(roomCode: string): string {
  // Always absolute. The origin comes from nativeApi, which is the one place
  // that knows the answer differs per platform: the page's own origin on web
  // (so dev, preview and tunnelled builds stay on themselves), and the API
  // origin on native (where the page origin is a virtual https://localhost
  // that points nowhere).
  return `${getApiWebSocketOrigin()}/api/room/${roomCode}/ws`;
}

export type RoomSocketOptions = {
  roomCode: string;
  nickname: string;
  /** Overridable for tests. */
  createSocket?: (url: string) => WebSocket;
  now?: () => number;
};

export class RoomSocket implements RoomTransport {
  private readonly roomCode: string;
  private nickname: string;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly now: () => number;

  private ws: WebSocket | null = null;
  private listeners = new Set<(frame: ServerFrame) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus = "connecting";

  /** Replayed to any late subscriber, so a screen that mounts mid-game renders at once. */
  private lastSnapshot: ServerFrame | null = null;

  private attempt = 0;
  private reconnectTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private probePending = false;
  private probeTimer: number | null = null;
  private lastFrameAt = 0;
  private disposed = false;

  constructor(options: RoomSocketOptions) {
    this.roomCode = options.roomCode;
    this.nickname = options.nickname;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.now = options.now ?? (() => Date.now());

    this.connect();
    this.startWatchdog();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  // ------------------------------------------------------------ lifecycle ----

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private connect(): void {
    if (this.disposed) return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    let socket: WebSocket;
    try {
      socket = this.createSocket(roomSocketUrl(this.roomCode));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener("open", () => {
      if (this.ws !== socket) return;
      this.lastFrameAt = this.now();
      this.clearProbe();
      // The seat is claimed by the JOIN frame, not by the connection - the
      // token is what proves this is the same player coming back.
      this.sendRaw({
        type: "join",
        nickname: this.nickname,
        playerId: getPlayerId(),
        playerToken: readToken(this.roomCode) ?? undefined,
      });
    });

    socket.addEventListener("message", (event) => {
      if (this.ws !== socket) return;
      this.lastFrameAt = this.now();
      // ANY inbound frame proves the socket is alive, not just a pong.
      this.clearProbe();

      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame;
      } catch {
        return;
      }

      if (frame.type === "joined") {
        // Only now is the connection actually usable, so this - not the socket
        // opening - is what counts as connected. The backoff resets here too,
        // so a server that accepts sockets but rejects joins keeps backing off.
        writeToken(this.roomCode, frame.playerToken);
        this.attempt = 0;
        this.setStatus("open");
      }
      if (frame.type === "snapshot") this.lastSnapshot = frame;

      for (const listener of this.listeners) listener(frame);
    });

    socket.addEventListener("close", () => {
      if (this.ws !== socket) return;
      this.ws = null;
      if (this.disposed) return;
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // A failed connection always also fires close; letting that path own the
      // retry avoids scheduling two reconnects for one failure.
      if (this.ws === socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.close();
        } catch {
          // Already closing.
        }
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.setStatus("reconnecting");
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    const delay = Math.round(base * (1 + Math.random() * BACKOFF_JITTER));
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Drops the current socket and reconnects immediately - used when a socket looks open but has stopped answering. */
  private forceReconnect(): void {
    const socket = this.ws;
    this.ws = null;
    this.clearProbe();
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus("reconnecting");
    this.connect();
  }

  // ------------------------------------------------------------- liveness ----

  /**
   * A socket can stay "open" long after it stopped working - a dropped mobile
   * connection often produces no close event at all. The only reliable test is
   * to ask the server something and see whether it answers.
   */
  private startWatchdog(): void {
    this.watchdogTimer = window.setInterval(() => {
      if (this.disposed) return;

      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      // A hidden tab is throttled and legitimately quiet; probing it would just
      // manufacture reconnects. The visibilitychange handler covers the return.
      if (hidden) return;

      if (this.ws?.readyState === WebSocket.OPEN && this.now() - this.lastFrameAt > SILENCE_BEFORE_PROBE_MS) {
        this.probe(PROBE_TIMEOUT_MS);
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private clearProbe(): void {
    this.probePending = false;
    if (this.probeTimer !== null) {
      window.clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  /**
   * Asks the server something and gives it `timeoutMs` to answer.
   *
   * The deadline gets its OWN timer rather than being checked on the watchdog
   * tick: with both on 5s they can align exactly, and a 3s resume timeout that
   * is only inspected every 5 seconds is not a 3s timeout at all.
   */
  private probe(timeoutMs: number): void {
    if (this.probePending) return;
    this.probePending = true;
    this.sendRaw({ type: "ping", clientSentAt: Date.now() });
    this.probeTimer = window.setTimeout(() => {
      this.probeTimer = null;
      if (this.disposed || !this.probePending) return;
      this.forceReconnect();
    }, timeoutMs);
  }

  private handleVisibilityChange = (): void => {
    if (this.disposed || document.visibilityState !== "visible") return;

    // Coming back from the background. The socket usually survived, but this
    // client's view is however many phases out of date - so check the
    // connection right now rather than waiting for the watchdog, and let the
    // next snapshot resync everything. Nothing is replayed.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.probe(RESUME_PROBE_TIMEOUT_MS);
    } else {
      this.forceReconnect();
    }
  };

  // ------------------------------------------------------------ transport ----

  private sendRaw(frame: ClientFrame): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      // The socket died mid-send; the close handler will reconnect.
    }
  }

  send(frame: ClientFrame): void {
    // Deliberately dropped rather than queued while disconnected. Every frame
    // here is a request about the CURRENT phase - replaying a stale "next
    // round" or a submit for a finished round after reconnecting would be
    // worse than losing it, and the server would reject it anyway.
    this.sendRaw(frame);
  }

  subscribe(listener: (frame: ServerFrame) => void): () => void {
    this.listeners.add(listener);
    if (this.lastSnapshot) listener(this.lastSnapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  close(): void {
    this.disposed = true;
    this.setStatus("closed");
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer !== null) window.clearInterval(this.watchdogTimer);
    this.clearProbe();
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    const socket = this.ws;
    this.ws = null;
    this.listeners.clear();
    this.statusListeners.clear();
    if (socket) {
      try {
        socket.close(1000, "left the room");
      } catch {
        // Already closed.
      }
    }
  }
}
