/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Play Together - one Durable Object per room code.
//
// This object is the ONLY authority in the feature. It owns the phase, the
// deadlines, the shape sequence and every score. A client can ask for things;
// it can never assert them. In particular:
//   - Scores are computed HERE, from the submitted drawing, using the same
//     engine/scoring.ts the single-player game uses. Nothing trusts a
//     client-reported score. (Contrast dailyChallengeDO.ts, which accepts a
//     bare number and documents that as a known hole - a real-time game
//     between friends cannot afford that.)
//   - Time is measured HERE. Deadlines are absolute server timestamps and are
//     enforced by state.setAlarm(), never by a client tick. Device clocks were
//     measured up to ~1.4s off the server during the Stage 2 spike, so a
//     client-supplied timestamp is not even reliable when it is honest.
//   - Identity is issued HERE. `playerToken` is server-generated; the
//     client-supplied playerId is only ever used to look up a reconnecting
//     seat, never as proof of who someone is.
//
// Every broadcast is a FULL SNAPSHOT (protocol.ts RoomSnapshot). There are no
// deltas: a player whose WebView was frozen in the background re-syncs by
// reading the next snapshot, which is the entire reconnect design.
//
// DELIBERATELY ABSENT: coins, achievements, streaks, progression and ads.
// Multiplayer must never write to any of them, and the structural guarantee is
// that this file imports none of those modules.
import { scoreAttempt } from "../src/engine/scoring";
import { getShapeById } from "../src/engine/shapeLibrary";
import { pickShapeSequence } from "../src/multiplayer/difficultyPool";
import {
  combineRoundScore,
  fromWirePath,
  HOST_ONLY_FRAMES,
  MP_LIMITS,
  MP_TIMINGS,
  parseClientFrame,
  sanitizeNickname,
  speedScore,
  TIMED_PHASES,
  type ClientFrame,
  type MultiplayerDifficulty,
  type PublicPlayer,
  type RoomPhase,
  type RoomSnapshot,
  type RoundCount,
  type RoundResult,
  type ServerErrorCode,
} from "../src/multiplayer/protocol";

const STATE_KEY = "room";

/** Per-socket rate limit: generous enough that no honest client trips it, tight enough to blunt a flood. */
const RATE_WINDOW_MS = 1000;
const RATE_MAX_FRAMES = 20;

type RoundEntry = {
  score: number;
  accuracy: number;
  speed: number;
  /** Server arrival time of the submit. */
  submittedAt: number;
};

type PlayerRecord = {
  seatId: string;
  /** Client-generated. Used ONLY to find a reconnecting seat; never authorization, never sent to anyone. */
  playerId: string;
  /** Server-issued secret. Presenting it is what proves a reconnecting client owns this seat. */
  playerToken: string;
  nickname: string;
  isHost: boolean;
  joinedAt: number;
  connected: boolean;
  totalScore: number;
  /** This round only; cleared when a round starts. */
  round: RoundEntry | null;
};

type RoomState = {
  roomCode: string;
  phase: RoomPhase;
  phaseStartsAt: number;
  phaseEndsAt: number | null;
  rounds: RoundCount;
  difficulty: MultiplayerDifficulty;
  /** 0-based; -1 before the first round. */
  roundIndex: number;
  shapeSequence: string[];
  players: PlayerRecord[];
  lastRound: RoundResult | null;
  championSeatId: string | null;
  createdAt: number;
  /** Bumped once per Start. See RoomSnapshot.gameSerial - it is what makes a Social Points award payable exactly once per match. */
  gameSerial: number;
  /** Set when the host disconnects; the role moves on if they are still gone when this passes. */
  hostGraceUntil: number | null;
  /** Set when the last player disconnects; the room is disposable once IDLE_TTL_MS has passed. */
  emptySince: number | null;
};

/** What a socket carries across hibernation. */
type SocketMeta = { seatId: string | null; rateWindowStart: number; rateCount: number };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function shortId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, length);
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class RoomDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  // ------------------------------------------------------------- storage ----

  private async load(): Promise<RoomState | null> {
    return (await this.state.storage.get<RoomState>(STATE_KEY)) ?? null;
  }

  private async save(room: RoomState): Promise<void> {
    await this.state.storage.put(STATE_KEY, room);
  }

  // -------------------------------------------------------------- sockets ----

  private metaOf(ws: WebSocket): SocketMeta {
    try {
      return (ws.deserializeAttachment() as SocketMeta) ?? { seatId: null, rateWindowStart: 0, rateCount: 0 };
    } catch {
      return { seatId: null, rateWindowStart: 0, rateCount: 0 };
    }
  }

  private send(ws: WebSocket, frame: unknown): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // Socket died between selection and send; the close handler cleans up.
    }
  }

  private fail(ws: WebSocket, code: ServerErrorCode, message: string): void {
    this.send(ws, { type: "error", code, message });
  }

  /** Sockets that have completed `join`, paired with their seat. */
  private seatedSockets(): { ws: WebSocket; seatId: string }[] {
    const out: { ws: WebSocket; seatId: string }[] = [];
    for (const ws of this.state.getWebSockets()) {
      const seatId = this.metaOf(ws).seatId;
      if (seatId) out.push({ ws, seatId });
    }
    return out;
  }

  // ------------------------------------------------------------ snapshots ----

  private publicPlayers(room: RoomState): PublicPlayer[] {
    return room.players
      .map((p) => ({
        seatId: p.seatId,
        nickname: p.nickname,
        isHost: p.isHost,
        connected: p.connected,
        totalScore: p.totalScore,
        roundScore: p.round?.score ?? null,
        roundAccuracy: p.round?.accuracy ?? null,
        roundSpeed: p.round?.speed ?? null,
        submitted: p.round !== null,
      }))
      // Lobby order while waiting, standings order once scores exist - so the
      // client never has to know which sort applies in which phase.
      .sort((a, b) => (room.phase === "LOBBY" ? 0 : b.totalScore - a.totalScore));
  }

  /**
   * The snapshot as seen by one seat. Personalised only in `you`; every other
   * field is identical for everyone, so there is no way to learn anything
   * about another player that the room does not publish.
   */
  private snapshotFor(room: RoomState, seatId: string | null): RoomSnapshot {
    const me = seatId ? room.players.find((p) => p.seatId === seatId) ?? null : null;
    return {
      type: "snapshot",
      roomCode: room.roomCode,
      phase: room.phase,
      phaseStartsAt: room.phaseStartsAt,
      phaseEndsAt: room.phaseEndsAt,
      serverNow: Date.now(),
      rounds: room.rounds,
      difficulty: room.difficulty,
      roundIndex: room.roundIndex,
      // Withheld before SHOW_SHAPE: otherwise the shape for the round is
      // sitting in a frame the player could read during COUNTDOWN.
      shapeId:
        room.phase === "SHOW_SHAPE" || room.phase === "DRAWING" || room.phase === "ROUND_RESULTS"
          ? room.shapeSequence[room.roundIndex] ?? null
          : null,
      players: this.publicPlayers(room),
      // ?? 0 for a room that was persisted by a build predating this field.
      gameSerial: room.gameSerial ?? 0,
      lastRound: room.lastRound,
      championSeatId: room.championSeatId,
      you: me ? { seatId: me.seatId, isHost: me.isHost, submitted: me.round !== null } : null,
    };
  }

  private broadcast(room: RoomState): void {
    for (const { ws, seatId } of this.seatedSockets()) {
      this.send(ws, this.snapshotFor(room, seatId));
    }
  }

  // ---------------------------------------------------------------- alarms ----

  /**
   * The single alarm slot has to serve three independent deadlines, so it is
   * always set to whichever comes first and `alarm()` re-checks all of them.
   *
   * The DRAWING deadline is deliberately scheduled at phaseEndsAt + grace, not
   * phaseEndsAt: a submit that left the device before the deadline but landed
   * a few hundred ms late must still count. Clients are shown the true
   * phaseEndsAt and auto-submit there; the grace only ever absorbs flight time.
   */
  private nextDeadline(room: RoomState): number | null {
    const candidates: number[] = [];

    if (TIMED_PHASES.has(room.phase) && room.phaseEndsAt !== null) {
      candidates.push(room.phase === "DRAWING" ? room.phaseEndsAt + MP_LIMITS.SUBMIT_GRACE_MS : room.phaseEndsAt);
    }
    if (room.hostGraceUntil !== null) candidates.push(room.hostGraceUntil);
    if (room.emptySince !== null) candidates.push(room.emptySince + MP_LIMITS.IDLE_TTL_MS);

    return candidates.length === 0 ? null : Math.min(...candidates);
  }

  private async reschedule(room: RoomState): Promise<void> {
    const next = this.nextDeadline(room);
    if (next === null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    const room = await this.load();
    if (!room) return;
    const now = Date.now();

    // Nobody has been connected for long enough - drop the room entirely.
    if (room.emptySince !== null && now >= room.emptySince + MP_LIMITS.IDLE_TTL_MS) {
      await this.state.storage.deleteAll();
      return;
    }

    if (room.hostGraceUntil !== null && now >= room.hostGraceUntil) {
      this.promoteHost(room);
      room.hostGraceUntil = null;
    }

    if (TIMED_PHASES.has(room.phase) && room.phaseEndsAt !== null) {
      const due = room.phase === "DRAWING" ? room.phaseEndsAt + MP_LIMITS.SUBMIT_GRACE_MS : room.phaseEndsAt;
      if (now >= due) await this.advancePhase(room);
    }

    await this.save(room);
    this.broadcast(room);
    await this.reschedule(room);
  }

  // ---------------------------------------------------------- state machine ----

  private enterPhase(room: RoomState, phase: RoomPhase, durationMs: number | null): void {
    const now = Date.now();
    room.phase = phase;
    room.phaseStartsAt = now;
    room.phaseEndsAt = durationMs === null ? null : now + durationMs;
  }

  /**
   * LOBBY -> COUNTDOWN -> SHOW_SHAPE -> DRAWING -> ROUND_RESULTS
   *                          ^                          |
   *                          +--- host "next" ----------+
   *                                                     |
   *                        last round -> FINAL_RESULTS -+-> host "rematch" -> LOBBY
   *
   * Only the three timed phases advance from here; ROUND_RESULTS and
   * FINAL_RESULTS have no deadline and wait for the host.
   */
  private async advancePhase(room: RoomState): Promise<void> {
    switch (room.phase) {
      case "COUNTDOWN":
        this.enterPhase(room, "SHOW_SHAPE", MP_TIMINGS.SHOW_SHAPE_MS);
        return;
      case "SHOW_SHAPE":
        this.enterPhase(room, "DRAWING", MP_TIMINGS.DRAWING_MS);
        return;
      case "DRAWING":
        this.finishRound(room);
        return;
      default:
        return;
    }
  }

  private startRound(room: RoomState, roundIndex: number): void {
    room.roundIndex = roundIndex;
    room.lastRound = null;
    for (const p of room.players) p.round = null;
    this.enterPhase(room, "COUNTDOWN", MP_TIMINGS.COUNTDOWN_MS);
  }

  /** Totals up the round, names a winner, and moves to ROUND_RESULTS (or FINAL_RESULTS after the last round). */
  private finishRound(room: RoomState): void {
    const shapeId = room.shapeSequence[room.roundIndex] ?? "";

    let winner: PlayerRecord | null = null;
    for (const p of room.players) {
      if (!p.round) continue;
      p.totalScore += p.round.score;
      if (
        !winner ||
        !winner.round ||
        p.round.score > winner.round.score ||
        // Tie on score goes to whoever got there first.
        (p.round.score === winner.round.score && p.round.submittedAt < winner.round.submittedAt)
      ) {
        winner = p;
      }
    }

    room.lastRound = { roundIndex: room.roundIndex, shapeId, winnerSeatId: winner?.seatId ?? null };

    const isLastRound = room.roundIndex >= room.rounds - 1;
    if (isLastRound) {
      room.championSeatId = this.championOf(room);
      this.enterPhase(room, "FINAL_RESULTS", null);
    } else {
      this.enterPhase(room, "ROUND_RESULTS", null);
    }
  }

  /** Highest total; a tie goes to whoever joined the room first. */
  private championOf(room: RoomState): string | null {
    let best: PlayerRecord | null = null;
    for (const p of room.players) {
      if (!best || p.totalScore > best.totalScore || (p.totalScore === best.totalScore && p.joinedAt < best.joinedAt)) {
        best = p;
      }
    }
    return best?.seatId ?? null;
  }

  /** Moves the host role to the longest-connected remaining player. */
  private promoteHost(room: RoomState): void {
    const connected = room.players.filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = connected[0];
    if (!next) return;
    for (const p of room.players) p.isHost = p.seatId === next.seatId;
  }

  /** True once every connected player has submitted - lets a round end early instead of burning the clock. */
  private everyoneSubmitted(room: RoomState): boolean {
    const active = room.players.filter((p) => p.connected);
    return active.length > 0 && active.every((p) => p.round !== null);
  }

  // ---------------------------------------------------------------- scoring ----

  /**
   * Scores one submission against the round's shape.
   *
   * The target is generated at the ATTEMPT's own canvas width, so both paths
   * live in the same coordinate space no matter what size canvas the client
   * drew on. That matters because scoreAttempt's scale component compares raw
   * bounding-box diagonals - normalising the two separately would silently
   * distort it for any client that is not exactly 320px.
   */
  private scoreSubmission(shapeId: string, frame: Extract<ClientFrame, { type: "submit" }>, arrivedAt: number, drawingStartedAt: number, deadline: number): RoundEntry | null {
    const shape = getShapeById(shapeId);
    if (!shape) return null;

    // The clock ran out on an empty canvas. Recorded as a real zero rather
    // than rejected, so the player counts as finished and the round can close.
    if (frame.path === null) {
      return { score: 0, accuracy: 0, speed: 0, submittedAt: arrivedAt };
    }

    const attempt = fromWirePath(frame.path);
    const target = shape.generate(attempt.canvasWidth);
    const accuracy = scoreAttempt(target, attempt).total;

    // Anything that arrives after the true deadline is inside the grace window
    // (the alarm has not fired yet) and still counts for accuracy - but it
    // earns no speed. The grace exists for network flight time, not as extra
    // thinking time.
    const rawSpeed = arrivedAt > deadline ? 0 : speedScore(arrivedAt - drawingStartedAt, MP_TIMINGS.DRAWING_MS);

    // Round the speed BEFORE combining, not just for display. Otherwise the
    // three numbers the player is shown (accuracy, speed, total) do not add up:
    // a raw speed of 99.7 displays as 100 but contributes 24.9, so the total
    // lands a point below what the visible components imply.
    const speed = Math.round(rawSpeed);
    return { score: combineRoundScore(accuracy, speed), accuracy, speed, submittedAt: arrivedAt };
  }

  // ----------------------------------------------------------- frame router ----

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MP_LIMITS.MAX_FRAME_BYTES) {
      return this.fail(ws, "bad_frame", "frame rejected");
    }

    // Per-socket rate limiting, carried in the attachment so it survives
    // hibernation along with the seat.
    const meta = this.metaOf(ws);
    const now = Date.now();
    if (now - meta.rateWindowStart > RATE_WINDOW_MS) {
      meta.rateWindowStart = now;
      meta.rateCount = 0;
    }
    meta.rateCount++;
    ws.serializeAttachment(meta);
    if (meta.rateCount > RATE_MAX_FRAMES) return this.fail(ws, "rate_limited", "slow down");

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return this.fail(ws, "bad_frame", "invalid json");
    }

    const frame = parseClientFrame(parsed);
    if (!frame) return this.fail(ws, "bad_frame", "unrecognised or malformed frame");

    if (frame.type === "ping") {
      return this.send(ws, { type: "pong", clientSentAt: frame.clientSentAt ?? null, serverNow: Date.now() });
    }

    const room = await this.load();
    if (!room) return this.fail(ws, "room_closed", "this room no longer exists");

    if (frame.type === "join") return this.handleJoin(ws, room, frame);

    // Everything below requires a seat.
    const seatId = this.metaOf(ws).seatId;
    const me = seatId ? room.players.find((p) => p.seatId === seatId) : undefined;
    if (!me) return this.fail(ws, "not_joined", "send join first");

    if (HOST_ONLY_FRAMES.has(frame.type) && !me.isHost) {
      return this.fail(ws, "not_host", "only the host can do that");
    }

    switch (frame.type) {
      case "setNickname":
        return this.handleSetNickname(room, me, frame.nickname);
      case "configure":
        return this.handleConfigure(ws, room, frame.rounds, frame.difficulty);
      case "start":
        return this.handleStart(ws, room);
      case "submit":
        return this.handleSubmit(ws, room, me, frame);
      case "next":
        return this.handleNext(ws, room);
      case "rematch":
        return this.handleRematch(ws, room);
    }
  }

  // -------------------------------------------------------------- handlers ----

  private async handleJoin(ws: WebSocket, room: RoomState, frame: Extract<ClientFrame, { type: "join" }>): Promise<void> {
    if (room.phase === "ABANDONED") return this.fail(ws, "room_closed", "this room is closed");

    // Reconnect path: a valid token reclaims the existing seat, in any phase.
    // The token is the ONLY thing that authorises this - matching playerId
    // alone would let anyone who learns an id steal a seat and its score.
    const existing = frame.playerToken
      ? room.players.find((p) => p.playerToken === frame.playerToken && p.playerId === frame.playerId)
      : undefined;

    if (existing) {
      existing.connected = true;
      existing.nickname = frame.nickname || existing.nickname;
      if (existing.isHost) room.hostGraceUntil = null;
      room.emptySince = null;

      // Drop any older socket still holding this seat, so one seat is never
      // driven by two connections at once.
      for (const { ws: other, seatId } of this.seatedSockets()) {
        if (seatId === existing.seatId && other !== ws) {
          try {
            other.close(1000, "seat reclaimed");
          } catch {
            // Already gone.
          }
        }
      }

      ws.serializeAttachment({ seatId: existing.seatId, rateWindowStart: Date.now(), rateCount: 0 } satisfies SocketMeta);
      this.send(ws, { type: "joined", seatId: existing.seatId, playerToken: existing.playerToken, roomCode: room.roomCode, serverNow: Date.now() });
      await this.save(room);
      this.broadcast(room);
      return this.reschedule(room);
    }

    // New player: lobby only. Joining mid-game would mean a player with no
    // score history sitting in the standings, so it is simply refused.
    if (room.phase !== "LOBBY") return this.fail(ws, "wrong_phase", "this game has already started");
    if (room.players.length >= MP_LIMITS.MAX_PLAYERS) return this.fail(ws, "room_full", "this room is full");

    const player: PlayerRecord = {
      seatId: shortId(),
      playerId: frame.playerId,
      playerToken: newToken(),
      nickname: this.uniqueNickname(room, frame.nickname),
      // First seat in an empty room takes the host role.
      isHost: room.players.length === 0,
      joinedAt: Date.now(),
      connected: true,
      totalScore: 0,
      round: null,
    };
    room.players.push(player);
    room.emptySince = null;

    ws.serializeAttachment({ seatId: player.seatId, rateWindowStart: Date.now(), rateCount: 0 } satisfies SocketMeta);
    this.send(ws, { type: "joined", seatId: player.seatId, playerToken: player.playerToken, roomCode: room.roomCode, serverNow: Date.now() });
    await this.save(room);
    this.broadcast(room);
    return this.reschedule(room);
  }

  /** Appends a numeric suffix when a nickname is already taken, so a leaderboard never shows two identical rows. */
  private uniqueNickname(room: RoomState, desired: string, excludeSeatId?: string): string {
    const taken = new Set(room.players.filter((p) => p.seatId !== excludeSeatId).map((p) => p.nickname.toLowerCase()));
    if (!taken.has(desired.toLowerCase())) return desired;
    for (let n = 2; n <= MP_LIMITS.MAX_PLAYERS + 1; n++) {
      const candidate = `${desired.slice(0, MP_LIMITS.MAX_NICKNAME_LENGTH - 2)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return desired;
  }

  private async handleSetNickname(room: RoomState, me: PlayerRecord, nickname: string): Promise<void> {
    me.nickname = this.uniqueNickname(room, sanitizeNickname(nickname), me.seatId);
    await this.save(room);
    this.broadcast(room);
  }

  private async handleConfigure(ws: WebSocket, room: RoomState, rounds: RoundCount, difficulty: MultiplayerDifficulty): Promise<void> {
    if (room.phase !== "LOBBY") return this.fail(ws, "wrong_phase", "settings can only change in the lobby");
    room.rounds = rounds;
    room.difficulty = difficulty;
    await this.save(room);
    this.broadcast(room);
  }

  private async handleStart(ws: WebSocket, room: RoomState): Promise<void> {
    if (room.phase !== "LOBBY") return this.fail(ws, "wrong_phase", "the game is already running");
    const connected = room.players.filter((p) => p.connected).length;
    if (connected < MP_LIMITS.MIN_PLAYERS_TO_START) {
      return this.fail(ws, "not_enough_players", `at least ${MP_LIMITS.MIN_PLAYERS_TO_START} players are needed`);
    }

    room.shapeSequence = pickShapeSequence(room.difficulty, room.rounds);
    room.championSeatId = null;
    // One Start, one match, one serial. handleRematch deliberately does NOT
    // bump this: it returns the room to the lobby, and the rematch only becomes
    // a match when somebody presses Start again.
    room.gameSerial = (room.gameSerial ?? 0) + 1;
    for (const p of room.players) p.totalScore = 0;
    this.startRound(room, 0);

    await this.save(room);
    this.broadcast(room);
    return this.reschedule(room);
  }

  private async handleSubmit(ws: WebSocket, room: RoomState, me: PlayerRecord, frame: Extract<ClientFrame, { type: "submit" }>): Promise<void> {
    if (room.phase !== "DRAWING") return this.fail(ws, "wrong_phase", "not currently drawing");
    // Guards a submit that was in flight while the round rolled over, which
    // would otherwise be scored against the wrong shape.
    if (frame.roundIndex !== room.roundIndex) return this.fail(ws, "too_late", "that round has ended");
    if (me.round) return this.fail(ws, "already_submitted", "you already submitted this round");

    const now = Date.now();
    const deadline = room.phaseEndsAt ?? now;
    if (now > deadline + MP_LIMITS.SUBMIT_GRACE_MS) return this.fail(ws, "too_late", "the deadline has passed");

    const shapeId = room.shapeSequence[room.roundIndex] ?? "";
    const entry = this.scoreSubmission(shapeId, frame, now, room.phaseStartsAt, deadline);
    if (!entry) return this.fail(ws, "bad_frame", "unknown shape for this round");
    me.round = entry;

    // Everyone is in - no reason to keep the rest of the clock running.
    if (this.everyoneSubmitted(room)) this.finishRound(room);

    await this.save(room);
    this.broadcast(room);
    return this.reschedule(room);
  }

  private async handleNext(ws: WebSocket, room: RoomState): Promise<void> {
    if (room.phase !== "ROUND_RESULTS") return this.fail(ws, "wrong_phase", "there is no round to advance from");
    this.startRound(room, room.roundIndex + 1);
    await this.save(room);
    this.broadcast(room);
    return this.reschedule(room);
  }

  private async handleRematch(ws: WebSocket, room: RoomState): Promise<void> {
    if (room.phase !== "FINAL_RESULTS") return this.fail(ws, "wrong_phase", "the game is not finished");
    room.roundIndex = -1;
    room.shapeSequence = [];
    room.lastRound = null;
    room.championSeatId = null;
    for (const p of room.players) {
      p.totalScore = 0;
      p.round = null;
    }
    this.enterPhase(room, "LOBBY", null);
    await this.save(room);
    this.broadcast(room);
    return this.reschedule(room);
  }

  // ------------------------------------------------------------ disconnects ----

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const seatId = this.metaOf(ws).seatId;
    if (!seatId) return;

    const room = await this.load();
    if (!room) return;

    const player = room.players.find((p) => p.seatId === seatId);
    if (!player) return;

    // Another socket may already have reclaimed this seat (reconnect races
    // ahead of the old socket's close). If so, this close is stale.
    const stillHeld = this.seatedSockets().some((s) => s.seatId === seatId && s.ws !== ws);
    if (stillHeld) return;

    player.connected = false;

    if (room.phase === "LOBBY") {
      // Nothing to preserve before the game starts, so the seat is released
      // rather than held - otherwise a few false starts fill the room up.
      room.players = room.players.filter((p) => p.seatId !== seatId);
      if (player.isHost) this.promoteHost(room);
    } else if (player.isHost) {
      // Mid-game the host keeps the role for a grace period, so a tunnel or a
      // lift does not reshuffle control of the game.
      room.hostGraceUntil = Date.now() + MP_LIMITS.HOST_GRACE_MS;
    }

    room.emptySince = room.players.some((p) => p.connected) ? null : Date.now();

    await this.save(room);
    this.broadcast(room);
    await this.reschedule(room);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  // ------------------------------------------------------------------ http ----

  private freshRoom(roomCode: string): RoomState {
    const now = Date.now();
    return {
      roomCode,
      phase: "LOBBY",
      phaseStartsAt: now,
      phaseEndsAt: null,
      rounds: 5,
      difficulty: "mixed",
      roundIndex: -1,
      shapeSequence: [],
      players: [],
      lastRound: null,
      championSeatId: null,
      createdAt: now,
      gameSerial: 0,
      hostGraceUntil: null,
      emptySince: now,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = url.searchParams.get("code") ?? "";

    // Claim a code. Answers 409 if this code is already a live room, which is
    // what lets the Worker retry with a different one instead of dropping a
    // new host into someone else's game.
    if (url.pathname === "/create" && request.method === "POST") {
      const existing = await this.load();
      if (existing) return json({ error: "room code in use" }, 409);
      const room = this.freshRoom(roomCode);
      await this.save(room);
      await this.reschedule(room);
      return json({ roomCode, createdAt: room.createdAt });
    }

    // Cheap existence check for the join screen, so a wrong code can be
    // reported before opening a socket.
    if (url.pathname === "/info" && request.method === "GET") {
      const room = await this.load();
      if (!room) return json({ error: "not found" }, 404);
      return json({
        roomCode: room.roomCode,
        phase: room.phase,
        players: room.players.length,
        maxPlayers: MP_LIMITS.MAX_PLAYERS,
        joinable: room.phase === "LOBBY" && room.players.length < MP_LIMITS.MAX_PLAYERS,
        serverNow: Date.now(),
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket upgrade" }, 426);
      const room = await this.load();
      if (!room) return json({ error: "no such room" }, 404);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Hibernation rather than server.accept(): a room idling in a lobby must
      // not pin this object in memory.
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ seatId: null, rateWindowStart: Date.now(), rateCount: 0 } satisfies SocketMeta);
      // No snapshot yet - the socket is anonymous until it sends `join`.
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: "not found" }, 404);
  }
}
