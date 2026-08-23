/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The Play Together wire contract, shared verbatim by the client and the
// Worker (worker/roomDO.ts imports straight from here).
//
// HARD RULE, same as engine/scoringConstants.ts: this module must stay free of
// anything that only exists in a Vite build. No `import.meta`, no
// __APP_BUILD__, no DOM, and no import of app/constants.ts. Type-only imports
// are fine because they are erased. If it can't run under plain workerd, it
// does not belong here.
//
// Everything the server sends is a FULL SNAPSHOT (see RoomSnapshot). There are
// no deltas and no event replay: a client that was backgrounded, throttled or
// disconnected re-syncs by reading the next snapshot and nothing else. That is
// the whole reconnect design, and it is why the phase timings below are
// absolute server timestamps rather than durations.
import type { DrawingPath } from "../types/Challenge";

// ---------------------------------------------------------------- limits ----

export const MP_LIMITS = {
  MIN_PLAYERS_TO_START: 2,
  MAX_PLAYERS: 8,
  /** Points per submitted drawing. The client resamples with the existing segment-aware resampler before sending; the server rejects anything longer. */
  MAX_SUBMIT_POINTS: 256,
  MAX_NICKNAME_LENGTH: 16,
  ROOM_CODE_LENGTH: 6,
  /** Largest single WebSocket frame the server will parse. */
  MAX_FRAME_BYTES: 16_000,
  /**
   * Allowance for network latency and jitter ONLY - a submit that left the
   * device before the deadline but landed just after it. It is deliberately
   * NOT a clock allowance: device clocks were measured up to ~1.4s off the
   * server during the Stage 2 spike, which is why clients render deadlines
   * through a measured clock offset instead of their own wall clock, and why
   * the server never trusts a client-reported timestamp.
   */
  SUBMIT_GRACE_MS: 1500,
  /** How long a disconnected host keeps the role before it moves to the longest-connected player. */
  HOST_GRACE_MS: 60_000,
  /** A room with no connected players for this long is disposable. */
  IDLE_TTL_MS: 30 * 60_000,
} as const;

export const MP_TIMINGS = {
  COUNTDOWN_MS: 3_000,
  SHOW_SHAPE_MS: 3_000,
  /**
   * The drawing window, and the denominator of the speed score.
   *
   * The single source of truth for both: the server phase deadline, the client
   * timer, the bots in the dev harness and speedScore() all derive from this,
   * so the window and the scoring can never disagree. Changing this number is
   * the whole change.
   *
   * Deliberately the same for every difficulty - a harder shape in the same 20
   * seconds is the difficulty, and per-tier windows would make scores across
   * settings incomparable.
   */
  DRAWING_MS: 20_000,
} as const;

export const ROUND_COUNT_OPTIONS = [5, 10, 15] as const;
export type RoundCount = (typeof ROUND_COUNT_OPTIONS)[number];

export const DIFFICULTY_OPTIONS = ["easy", "medium", "hard", "mixed"] as const;
export type MultiplayerDifficulty = (typeof DIFFICULTY_OPTIONS)[number];

/** Same unambiguous 32-symbol alphabet the share ids use - no 0/O/1/I, so a code can be read aloud. */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && ROOM_CODE_PATTERN.test(value);
}

// ---------------------------------------------------------------- phases ----

/**
 * The server-authoritative room phase.
 *
 * Deliberately smaller than the first draft of this design:
 *   - there is no CALCULATING phase; server-side scoring of 8 players takes
 *     well under a millisecond, so the "analyzing" beat is a client-side
 *     flourish, not a state everyone has to be dragged through and re-synced to.
 *   - ROUND_WINNER and LEADERBOARD are one phase (ROUND_RESULTS). The snapshot
 *     carries the winner and the standings together and the client sequences
 *     the animation locally, which removes the race where the host advances
 *     while someone else is still watching a winner reveal.
 *   - there is no WAITING_FOR_HOST phase; that IS ROUND_RESULTS, which simply
 *     has no deadline. The host sees a button, everyone else sees a caption.
 */
export const ROOM_PHASES = [
  "LOBBY",
  "COUNTDOWN",
  "SHOW_SHAPE",
  "DRAWING",
  "ROUND_RESULTS",
  "FINAL_RESULTS",
  "ABANDONED",
] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

/** Phases the server leaves on a timer. Every other phase waits for a host action. */
export const TIMED_PHASES: ReadonlySet<RoomPhase> = new Set<RoomPhase>(["COUNTDOWN", "SHOW_SHAPE", "DRAWING"]);

// ------------------------------------------------------------- wire path ----

/** A drawing on the wire: rounded integer pairs instead of {x,y,t} objects, which is ~3x smaller and loses nothing the scorer uses. */
export type WirePath = {
  p: [number, number][];
  w: number;
  h: number;
  /** Indices where a new disconnected segment begins - preserved so the scorer never sees a phantom connector line. */
  b?: number[];
};

export function toWirePath(path: DrawingPath): WirePath {
  return {
    p: path.points.map((pt) => [Math.round(pt.x), Math.round(pt.y)] as [number, number]),
    w: path.canvasWidth,
    h: path.canvasHeight,
    b: path.breaks && path.breaks.length > 0 ? path.breaks : undefined,
  };
}

export function fromWirePath(wire: WirePath): DrawingPath {
  return {
    points: wire.p.map(([x, y], i) => ({ x, y, t: i })),
    canvasWidth: wire.w,
    canvasHeight: wire.h,
    breaks: wire.b,
  };
}

const MAX_CANVAS_DIM = 4096;

/** Full structural validation of an untrusted drawing payload. Returns null when the value is unusable. */
export function parseWirePath(value: unknown): WirePath | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  const w = v.w;
  const h = v.h;
  if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || w > MAX_CANVAS_DIM) return null;
  if (typeof h !== "number" || !Number.isFinite(h) || h <= 0 || h > MAX_CANVAS_DIM) return null;

  if (!Array.isArray(v.p)) return null;
  if (v.p.length < 2 || v.p.length > MP_LIMITS.MAX_SUBMIT_POINTS) return null;

  const points: [number, number][] = [];
  for (const entry of v.p) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [x, y] = entry;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    // Generous bound rather than a strict 0..w clamp: a stroke legitimately
    // runs a little past the canvas edge before pointer capture ends it.
    if (Math.abs(x) > MAX_CANVAS_DIM || Math.abs(y) > MAX_CANVAS_DIM) return null;
    points.push([x, y]);
  }

  let breaks: number[] | undefined;
  if (v.b !== undefined) {
    if (!Array.isArray(v.b)) return null;
    if (v.b.length > points.length) return null;
    const parsed: number[] = [];
    let previous = 0;
    for (const b of v.b) {
      if (typeof b !== "number" || !Number.isInteger(b)) return null;
      // Strictly increasing and inside the array, so segment slicing can never
      // produce an empty or reversed segment downstream.
      if (b <= previous || b >= points.length) return null;
      previous = b;
      parsed.push(b);
    }
    breaks = parsed;
  }

  return { p: points, w, h, b: breaks };
}

// ------------------------------------------------------- client -> server ----

export type ClientFrame =
  | { type: "join"; nickname: string; playerId: string; playerToken?: string }
  | { type: "setNickname"; nickname: string }
  | { type: "configure"; rounds: RoundCount; difficulty: MultiplayerDifficulty }
  | { type: "start" }
  /**
   * `path: null` is a deliberate empty submission - the drawing clock ran out
   * with nothing on the canvas. It is distinct from never submitting: it marks
   * the player finished so the round can close early instead of everyone
   * waiting out the full window for someone who drew nothing. It scores zero.
   */
  | { type: "submit"; roundIndex: number; path: WirePath | null }
  | { type: "next" }
  | { type: "rematch" }
  | { type: "ping"; clientSentAt?: number };

/** Frames only the host may send. Everything else is allowed from any joined player. */
export const HOST_ONLY_FRAMES: ReadonlySet<string> = new Set(["configure", "start", "next", "rematch"]);

// Invisible codepoints that must never reach a leaderboard row. Listed
// numerically rather than as a regex escape range so the source stays free of
// literal control characters.
const ZERO_WIDTH_AND_BIDI: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, // zero-width space/non-joiner/joiner + LTR/RTL marks
  0x2028, 0x2029, // line / paragraph separators
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi embedding + override
  0x2066, 0x2067, 0x2068, 0x2069, // bidi isolates
  0xfeff, // BOM / zero-width no-break space
]);

/**
 * Trims a nickname to something safe to render in a leaderboard row.
 *
 * Drops C0/C1 control characters and the invisible codepoints above. They
 * render as nothing, but a bidi override can visually reorder the rest of the
 * row, and a zero-width joiner lets two players pick names that look
 * identical. Filtering happens BEFORE the length cap, so the cap applies to
 * what is actually displayed rather than to invisible padding.
 */
export function sanitizeNickname(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    if (ZERO_WIDTH_AND_BIDI.has(code)) continue;
    out += ch;
  }
  return out.trim().slice(0, MP_LIMITS.MAX_NICKNAME_LENGTH);
}

export function isRoundCount(value: unknown): value is RoundCount {
  return ROUND_COUNT_OPTIONS.includes(value as RoundCount);
}

export function isMultiplayerDifficulty(value: unknown): value is MultiplayerDifficulty {
  return DIFFICULTY_OPTIONS.includes(value as MultiplayerDifficulty);
}

/**
 * Parses an untrusted inbound frame. Anything not explicitly recognised and
 * fully valid returns null, which the caller answers with an error frame -
 * there is no partial acceptance and no default-filling of missing fields.
 */
export function parseClientFrame(raw: unknown): ClientFrame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;

  switch (f.type) {
    case "join": {
      const nickname = sanitizeNickname(f.nickname);
      if (!nickname) return null;
      if (typeof f.playerId !== "string" || f.playerId.length === 0 || f.playerId.length > 64) return null;
      if (f.playerToken !== undefined && (typeof f.playerToken !== "string" || f.playerToken.length > 64)) return null;
      return { type: "join", nickname, playerId: f.playerId, playerToken: f.playerToken as string | undefined };
    }
    case "setNickname": {
      const nickname = sanitizeNickname(f.nickname);
      if (!nickname) return null;
      return { type: "setNickname", nickname };
    }
    case "configure": {
      if (!isRoundCount(f.rounds) || !isMultiplayerDifficulty(f.difficulty)) return null;
      return { type: "configure", rounds: f.rounds, difficulty: f.difficulty };
    }
    case "start":
      return { type: "start" };
    case "submit": {
      if (typeof f.roundIndex !== "number" || !Number.isInteger(f.roundIndex) || f.roundIndex < 0) return null;
      // Explicit null is the empty submission. `undefined` is not: a missing
      // field is a malformed frame, not a considered "I drew nothing".
      if (f.path === null) return { type: "submit", roundIndex: f.roundIndex, path: null };
      const path = parseWirePath(f.path);
      if (!path) return null;
      return { type: "submit", roundIndex: f.roundIndex, path };
    }
    case "next":
      return { type: "next" };
    case "rematch":
      return { type: "rematch" };
    case "ping": {
      if (f.clientSentAt !== undefined && typeof f.clientSentAt !== "number") return null;
      return { type: "ping", clientSentAt: f.clientSentAt as number | undefined };
    }
    default:
      return null;
  }
}

// ------------------------------------------------------- server -> client ----

export type PublicPlayer = {
  /** Server-assigned, room-scoped. Never the client's own playerId - that is never echoed to anyone, including its owner's peers. */
  seatId: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  totalScore: number;
  /** This round's result, or null before it has been scored / if they never submitted. */
  roundScore: number | null;
  roundAccuracy: number | null;
  roundSpeed: number | null;
  /** Whether they have submitted for the round in progress - drives the "3/5 done" readout. */
  submitted: boolean;
};

export type RoundResult = {
  roundIndex: number;
  shapeId: string;
  /** seatId of the round winner, or null if nobody submitted. */
  winnerSeatId: string | null;
};

export type RoomSnapshot = {
  type: "snapshot";
  roomCode: string;
  phase: RoomPhase;
  /** Server epoch ms. Absolute, never a duration - the client renders it through its measured clock offset. */
  phaseStartsAt: number;
  /** null for phases with no deadline (LOBBY, ROUND_RESULTS, FINAL_RESULTS, ABANDONED). */
  phaseEndsAt: number | null;
  serverNow: number;
  rounds: RoundCount;
  difficulty: MultiplayerDifficulty;
  /** 0-based. -1 in the lobby, before any round has started. */
  roundIndex: number;
  /** Withheld until SHOW_SHAPE, so the shape cannot be read out of an early frame. */
  shapeId: string | null;
  players: PublicPlayer[];
  lastRound: RoundResult | null;
  /** seatId of the overall winner - only set in FINAL_RESULTS. */
  championSeatId: string | null;
  /**
   * Which match this is within the room: 1 for the first, bumped on every
   * Start, so a rematch is a different number.
   *
   * The client uses it as the idempotency key for Social Points. It has to come
   * from the server because it must survive a reconnect and a remount - a
   * counter held by the client would restart at exactly the moment the guard is
   * needed - and it must differ between a repeat of the final snapshot (same
   * serial, no second award) and a genuinely new rematch (new serial, new
   * award).
   */
  gameSerial: number;
  /** The receiving player's own view: who they are and what they may do. */
  you: { seatId: string; isHost: boolean; submitted: boolean } | null;
};

export type ServerFrame =
  | RoomSnapshot
  | { type: "joined"; seatId: string; playerToken: string; roomCode: string; serverNow: number }
  | { type: "pong"; clientSentAt: number | null; serverNow: number }
  | { type: "error"; code: ServerErrorCode; message: string };

export const SERVER_ERROR_CODES = [
  "bad_frame",
  "not_joined",
  "not_host",
  "room_full",
  "room_closed",
  "wrong_phase",
  "too_late",
  "already_submitted",
  "not_enough_players",
  "rate_limited",
] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

// ---------------------------------------------------------------- scoring ----

export const MP_SCORE_WEIGHTS = { accuracy: 0.75, speed: 0.25 } as const;

/**
 * Speed component, 0-100: `100 * (1 - elapsed / DRAWING_MS)`, clamped. Full
 * marks for an instant answer, zero at the deadline, linear in between - so
 * with a 20-second window, finishing at 10s is worth 50.
 *
 * `elapsedMs` is measured entirely on the server, from the moment DRAWING began
 * to the moment the submit arrived - never from a client-supplied timestamp,
 * which cannot be trusted and (per the Stage 2 measurements) is not even
 * accurate on an honest device.
 *
 * A submit that lands inside the post-deadline grace does not come through
 * here at all: callers force speed to 0, because the grace exists for network
 * flight time and not as extra thinking time.
 */
export function speedScore(elapsedMs: number, windowMs: number = MP_TIMINGS.DRAWING_MS): number {
  if (windowMs <= 0) return 0;
  const ratio = elapsedMs / windowMs;
  return Math.max(0, Math.min(100, 100 * (1 - ratio)));
}

/** The published formula: 75% drawing accuracy, 25% speed. */
export function combineRoundScore(accuracy: number, speed: number): number {
  const a = Math.max(0, Math.min(100, accuracy));
  const s = Math.max(0, Math.min(100, speed));
  return Math.round(a * MP_SCORE_WEIGHTS.accuracy + s * MP_SCORE_WEIGHTS.speed);
}
