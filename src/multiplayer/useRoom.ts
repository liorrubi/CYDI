/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus, RoomTransport } from "./roomTransport";
import type { ClientFrame, RoomSnapshot, ServerErrorCode } from "./protocol";

export type RoomError = { code: ServerErrorCode; message: string };

export type RoomView = {
  snapshot: RoomSnapshot | null;
  error: RoomError | null;
  dismissError: () => void;
  send: (frame: ClientFrame) => void;
  /**
   * serverClock - deviceClock, in ms. Every deadline in a snapshot is a SERVER
   * timestamp, so rendering one against the device's own clock is wrong by
   * whatever the two disagree by - measured at up to ~1.4s on a real phone
   * during the Stage 2 spike. Add this to Date.now() before comparing.
   */
  clockOffsetMs: number;
  status: ConnectionStatus;
};

/** Measured from the lowest-latency ping seen so far: the sample with the least round-trip has the least uncertainty about where the server clock actually was. */
const PING_INTERVAL_MS = 10_000;

export function useRoom(transport: RoomTransport | null): RoomView {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const bestRttRef = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => {
    if (!transport) return;
    bestRttRef.current = Number.POSITIVE_INFINITY;

    const unsubscribe = transport.subscribe((frame) => {
      switch (frame.type) {
        case "snapshot":
          setSnapshot(frame);
          return;
        case "error":
          setError({ code: frame.code, message: frame.message });
          return;
        case "pong": {
          if (frame.clientSentAt === null) return;
          const rtt = Date.now() - frame.clientSentAt;
          if (rtt >= bestRttRef.current) return;
          bestRttRef.current = rtt;
          // Assume the request and the reply each took half the round trip.
          setClockOffsetMs(frame.serverNow - (frame.clientSentAt + Date.now()) / 2);
          return;
        }
        case "joined":
          return;
      }
    });

    // A transport with no status channel is the in-memory dev harness, which
    // is never anything but connected.
    let unsubscribeStatus = () => {};
    if (transport.subscribeStatus) unsubscribeStatus = transport.subscribeStatus((next) => setStatus(next));
    else setStatus("open");

    const ping = () => transport.send({ type: "ping", clientSentAt: Date.now() });
    ping();
    const interval = window.setInterval(ping, PING_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      unsubscribe();
      unsubscribeStatus();
    };
  }, [transport]);

  return {
    snapshot,
    error,
    dismissError: () => setError(null),
    send: (frame) => transport?.send(frame),
    clockOffsetMs,
    status,
  };
}

/**
 * Milliseconds left until a server deadline, corrected for clock skew and
 * re-evaluated on an interval. Returns null when the phase has no deadline.
 *
 * Deliberately driven by setInterval rather than requestAnimationFrame: rAF
 * stops entirely in a backgrounded tab or WebView, and this value must be
 * correct the instant the player looks at the screen again. Because it is
 * derived from an absolute server timestamp rather than counted down locally,
 * a frozen tab resumes with the right number instead of a stale one.
 */
export function useDeadlineRemaining(endsAt: number | null, clockOffsetMs: number, tickMs = 200): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(null);
      return;
    }
    const compute = () => setRemaining(Math.max(0, endsAt - (Date.now() + clockOffsetMs)));
    compute();
    const interval = window.setInterval(compute, tickMs);
    return () => window.clearInterval(interval);
  }, [endsAt, clockOffsetMs, tickMs]);

  return remaining;
}
