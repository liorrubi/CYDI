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

// Clock sync and liveness are two different jobs, and used to be done by one frame
// every 10 seconds (B1). That frame carried a timestamp, so it had to wake RoomDO -
// roughly 60% of all RoomDO requests on 23 Sep 2026 came from sockets doing nothing
// but this. They are now separate:
//
//   - the offset is measured in a short BURST at connect, because bestRtt below keeps
//     only the lowest-latency sample ever seen, so accuracy stops improving after a
//     handful and a permanent 10-second cadence was buying nothing;
//   - staying connected is proved by a fixed liveness frame the Cloudflare runtime
//     answers on its own, without waking the object at all (protocol.ts
//     WS_LIVENESS_PING).
//
/** Sample delays after connect. Four samples in six seconds: enough for bestRtt to settle, short enough to be right before the first countdown. */
const CLOCK_BURST_DELAYS_MS = [0, 1_000, 3_000, 6_000];
/** Two samples are enough to re-establish an offset that only drifted; a resume is not a fresh connection. */
const CLOCK_RESYNC_DELAYS_MS = [0, 1_000];
/**
 * Liveness cadence. Deliberately SHORTER than roomSocket's SILENCE_BEFORE_PROBE_MS
 * (20s): if the socket ever went quiet for longer, the watchdog would fire a real
 * timestamped probe and put the billed wake straight back. Free frames at 15s are
 * what keep that dormant.
 */
const LIVENESS_INTERVAL_MS = 15_000;
/** Hidden for longer than this and the offset is treated as stale on return - a suspended WebView's clock can drift. */
const STALE_HIDDEN_MS = 60_000;

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

    // --- clock sync: a burst now, and again only if a resume made it stale ---
    const timers: number[] = [];
    const clockPing = () => transport.send({ type: "ping", clientSentAt: Date.now() });
    const burst = (delays: readonly number[]) => {
      for (const delay of delays) {
        if (delay === 0) clockPing();
        else timers.push(window.setTimeout(clockPing, delay));
      }
    };
    burst(CLOCK_BURST_DELAYS_MS);

    // --- liveness: answered by the runtime, so this costs no DO request ---
    const liveness = () => transport.send({ type: "lp" });
    const livenessInterval = window.setInterval(liveness, LIVENESS_INTERVAL_MS);

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // A short tab switch cannot have moved the clock meaningfully; a long
      // suspension can, and every countdown on screen is rendered against it.
      if (away >= STALE_HIDDEN_MS) {
        bestRttRef.current = Number.POSITIVE_INFINITY;
        burst(CLOCK_RESYNC_DELAYS_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.clearInterval(livenessInterval);
      document.removeEventListener("visibilitychange", onVisibility);
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
