/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// DEV/TEST HARNESS ONLY - not shipped in any product path.
//
// An in-memory Play Together room with scripted opponents, so the whole
// experience can be exercised in one process with no server and no network.
// Since Stage 5 the product runs on roomSocket.ts against the real RoomDO;
// nothing under src/screens or src/components imports this file, and the
// isolation test asserts that. It stays because it makes the UI and the state
// machine testable without standing up a Worker.
//
// It is a harness, not a second implementation of the game.
//
// It is deliberately NOT a port of worker/roomDO.ts. That module needs
// Cloudflare's DurableObjectState/WebSocketPair globals, and pulling
// @cloudflare/workers-types into the app tsconfig would collide with the DOM's
// own WebSocket/Response types. So the two share what actually matters instead:
//   - the same protocol types and phase names (protocol.ts)
//   - the same timings (MP_TIMINGS) and limits (MP_LIMITS)
//   - the same scoring: engine/scoring.ts for accuracy, and the same
//     speedScore/combineRoundScore for the 75/25 split
//   - the same shape pools (difficultyPool.ts)
// The parts that are simulated are the parts a harness can only simulate:
// other people, and the network.
//
// Divergence risk is real and accepted for one stage: Stage 5 deletes this as
// the default path and drives the same UI from RoomDO over a WebSocket.
import { scoreAttempt } from "../engine/scoring";
import { getShapeById } from "../engine/shapeLibrary";
import { pickShapeSequence } from "./difficultyPool";
import {
  combineRoundScore,
  fromWirePath,
  MP_LIMITS,
  MP_TIMINGS,
  speedScore,
  type ClientFrame,
  type MultiplayerDifficulty,
  type PublicPlayer,
  type RoomPhase,
  type RoomSnapshot,
  type RoundCount,
  type RoundResult,
  type ServerFrame,
} from "./protocol";
import type { RoomTransport } from "./roomTransport";

/** A scripted opponent. `skill` is the accuracy they tend to draw at; `pace` is how far into the window they submit. */
export type BotProfile = {
  nickname: string;
  /** Mean accuracy, 0-100. */
  skill: number;
  /** Fraction of the drawing window before they hit DONE, 0-1. */
  pace: number;
};

/**
 * The default cast. Chosen to make every UI state reachable by watching one
 * game: Maya is a genuine rival, Tom is fast but sloppy, Dana is slow and
 * accurate, so the leaderboard actually moves and the winner is not always the
 * same person.
 */
export const DEFAULT_BOTS: BotProfile[] = [
  { nickname: "Maya", skill: 78, pace: 0.55 },
  { nickname: "Tom", skill: 52, pace: 0.3 },
  { nickname: "Dana", skill: 84, pace: 0.8 },
];

type FakePlayer = {
  seatId: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  totalScore: number;
  round: { score: number; accuracy: number; speed: number; submittedAt: number } | null;
  bot: BotProfile | null;
};

export type FakeRoomOptions = {
  /** The local player's name. */
  nickname: string;
  /** "create" makes you host; "join" drops you into a room a bot already hosts. */
  mode: "create" | "join";
  roomCode: string;
  rounds?: RoundCount;
  difficulty?: MultiplayerDifficulty;
  bots?: BotProfile[];
  /** Overridable so tests can run a whole game without waiting real seconds. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
  /** Overridable so tests get a deterministic shape sequence and bot scores. */
  random?: () => number;
};

const YOU_SEAT = "you";

export class FakeRoom implements RoomTransport {
  private listeners = new Set<(frame: ServerFrame) => void>();
  private timers = new Set<number>();
  private closed = false;

  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => number;
  private clearTimer: (handle: number) => void;
  private random: () => number;

  private roomCode: string;
  private phase: RoomPhase = "LOBBY";
  private phaseStartsAt = 0;
  private phaseEndsAt: number | null = null;
  private rounds: RoundCount;
  private difficulty: MultiplayerDifficulty;
  private roundIndex = -1;
  private shapeSequence: string[] = [];
  private players: FakePlayer[] = [];
  private lastRound: RoundResult | null = null;
  private championSeatId: string | null = null;

  constructor(options: FakeRoomOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => window.clearTimeout(h));
    this.random = options.random ?? Math.random;

    this.roomCode = options.roomCode;
    this.rounds = options.rounds ?? 10;
    this.difficulty = options.difficulty ?? "mixed";
    this.phaseStartsAt = this.now();

    const bots = options.bots ?? DEFAULT_BOTS;
    const youAreHost = options.mode === "create";

    this.players.push({
      seatId: YOU_SEAT,
      nickname: options.nickname,
      isHost: youAreHost,
      connected: true,
      totalScore: 0,
      round: null,
      bot: null,
    });

    if (youAreHost) {
      // Trickle the others in, so the lobby's "waiting for players" state is
      // something you actually see rather than a frame that flashes past.
      bots.forEach((bot, i) => {
        this.after(700 + i * 900, () => this.addBot(bot, false));
      });
    } else {
      // Joining: someone is already hosting, and they start the game shortly -
      // otherwise the guest flow would have no way to progress on its own.
      this.addBot(bots[0], true);
      bots.slice(1).forEach((bot, i) => this.after(500 + i * 700, () => this.addBot(bot, false)));
      this.after(6000, () => {
        if (this.phase === "LOBBY") this.startGame();
      });
    }
  }

  // ------------------------------------------------------------- plumbing ----

  private after(ms: number, fn: () => void): void {
    if (this.closed) return;
    const handle = this.setTimer(() => {
      this.timers.delete(handle);
      if (!this.closed) fn();
    }, ms);
    this.timers.add(handle);
  }

  private clearTimers(): void {
    for (const handle of this.timers) this.clearTimer(handle);
    this.timers.clear();
  }

  private addBot(bot: BotProfile, isHost: boolean): void {
    if (this.players.length >= MP_LIMITS.MAX_PLAYERS) return;
    if (this.players.some((p) => p.nickname === bot.nickname)) return;
    this.players.push({
      seatId: `bot-${bot.nickname.toLowerCase()}`,
      nickname: bot.nickname,
      isHost,
      connected: true,
      totalScore: 0,
      round: null,
      bot,
    });
    this.emitSnapshot();
  }

  private emit(frame: ServerFrame): void {
    for (const listener of this.listeners) listener(frame);
  }

  private snapshot(): RoomSnapshot {
    const you = this.players.find((p) => p.seatId === YOU_SEAT) ?? null;
    const players: PublicPlayer[] = this.players
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
      .sort((a, b) => (this.phase === "LOBBY" ? 0 : b.totalScore - a.totalScore));

    return {
      type: "snapshot",
      roomCode: this.roomCode,
      phase: this.phase,
      phaseStartsAt: this.phaseStartsAt,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this.now(),
      rounds: this.rounds,
      difficulty: this.difficulty,
      roundIndex: this.roundIndex,
      // Same rule as the server: never before SHOW_SHAPE.
      shapeId:
        this.phase === "SHOW_SHAPE" || this.phase === "DRAWING" || this.phase === "ROUND_RESULTS"
          ? this.shapeSequence[this.roundIndex] ?? null
          : null,
      players,
      lastRound: this.lastRound,
      championSeatId: this.championSeatId,
      you: you ? { seatId: you.seatId, isHost: you.isHost, submitted: you.round !== null } : null,
    };
  }

  private emitSnapshot(): void {
    this.emit(this.snapshot());
  }

  private enterPhase(phase: RoomPhase, durationMs: number | null): void {
    this.phase = phase;
    this.phaseStartsAt = this.now();
    this.phaseEndsAt = durationMs === null ? null : this.phaseStartsAt + durationMs;
    this.emitSnapshot();
    if (durationMs !== null) this.after(durationMs, () => this.advance());
  }

  // -------------------------------------------------------- state machine ----

  private advance(): void {
    switch (this.phase) {
      case "COUNTDOWN":
        this.enterPhase("SHOW_SHAPE", MP_TIMINGS.SHOW_SHAPE_MS);
        return;
      case "SHOW_SHAPE":
        this.beginDrawing();
        return;
      case "DRAWING":
        this.finishRound();
        return;
      default:
        return;
    }
  }

  private startGame(): void {
    this.shapeSequence = pickShapeSequence(this.difficulty, this.rounds, this.random);
    this.championSeatId = null;
    for (const p of this.players) {
      p.totalScore = 0;
      p.round = null;
    }
    this.startRound(0);
  }

  private startRound(roundIndex: number): void {
    this.clearTimers();
    this.roundIndex = roundIndex;
    this.lastRound = null;
    for (const p of this.players) p.round = null;
    this.enterPhase("COUNTDOWN", MP_TIMINGS.COUNTDOWN_MS);
  }

  private beginDrawing(): void {
    this.enterPhase("DRAWING", MP_TIMINGS.DRAWING_MS);
    // Schedule each opponent's DONE. Jittered around their pace so the
    // "3 of 4 finished" readout ticks up at a believable rhythm.
    for (const player of this.players) {
      if (!player.bot) continue;
      const jitter = 0.85 + this.random() * 0.3;
      const delay = Math.min(MP_TIMINGS.DRAWING_MS - 250, player.bot.pace * jitter * MP_TIMINGS.DRAWING_MS);
      this.after(delay, () => this.botSubmit(player));
    }
  }

  private botSubmit(player: FakePlayer): void {
    if (this.phase !== "DRAWING" || player.round) return;
    const bot = player.bot!;
    const elapsed = this.now() - this.phaseStartsAt;
    const spread = (this.random() - 0.5) * 24;
    const accuracy = Math.max(5, Math.min(99, Math.round(bot.skill + spread)));
    const speed = Math.round(speedScore(elapsed, MP_TIMINGS.DRAWING_MS));
    player.round = { score: combineRoundScore(accuracy, speed), accuracy, speed, submittedAt: this.now() };
    if (this.everyoneSubmitted()) this.finishRound();
    else this.emitSnapshot();
  }

  private everyoneSubmitted(): boolean {
    return this.players.length > 0 && this.players.every((p) => p.round !== null);
  }

  private finishRound(): void {
    this.clearTimers();
    const shapeId = this.shapeSequence[this.roundIndex] ?? "";

    let winner: FakePlayer | null = null;
    for (const p of this.players) {
      if (!p.round) continue;
      p.totalScore += p.round.score;
      if (
        !winner ||
        !winner.round ||
        p.round.score > winner.round.score ||
        (p.round.score === winner.round.score && p.round.submittedAt < winner.round.submittedAt)
      ) {
        winner = p;
      }
    }
    this.lastRound = { roundIndex: this.roundIndex, shapeId, winnerSeatId: winner?.seatId ?? null };

    if (this.roundIndex >= this.rounds - 1) {
      this.championSeatId = this.championOf();
      this.enterPhase("FINAL_RESULTS", null);
    } else {
      this.enterPhase("ROUND_RESULTS", null);
    }
  }

  private championOf(): string | null {
    let best: FakePlayer | null = null;
    for (const p of this.players) {
      if (!best || p.totalScore > best.totalScore) best = p;
    }
    return best?.seatId ?? null;
  }

  // ------------------------------------------------------- inbound frames ----

  send(frame: ClientFrame): void {
    if (this.closed) return;
    const you = this.players.find((p) => p.seatId === YOU_SEAT);
    if (!you) return;

    switch (frame.type) {
      case "ping":
        this.emit({ type: "pong", clientSentAt: frame.clientSentAt ?? null, serverNow: this.now() });
        return;

      case "configure":
        if (!you.isHost) return this.emit({ type: "error", code: "not_host", message: "only the host can do that" });
        if (this.phase !== "LOBBY") return this.emit({ type: "error", code: "wrong_phase", message: "settings can only change in the lobby" });
        this.rounds = frame.rounds;
        this.difficulty = frame.difficulty;
        this.emitSnapshot();
        return;

      case "start":
        if (!you.isHost) return this.emit({ type: "error", code: "not_host", message: "only the host can do that" });
        if (this.phase !== "LOBBY") return this.emit({ type: "error", code: "wrong_phase", message: "the game is already running" });
        if (this.players.filter((p) => p.connected).length < MP_LIMITS.MIN_PLAYERS_TO_START) {
          return this.emit({ type: "error", code: "not_enough_players", message: "at least 2 players are needed" });
        }
        this.startGame();
        return;

      case "submit": {
        if (this.phase !== "DRAWING") return this.emit({ type: "error", code: "wrong_phase", message: "not currently drawing" });
        if (frame.roundIndex !== this.roundIndex) return this.emit({ type: "error", code: "too_late", message: "that round has ended" });
        if (you.round) return this.emit({ type: "error", code: "already_submitted", message: "you already submitted this round" });

        const arrivedAt = this.now();
        const deadline = this.phaseEndsAt ?? arrivedAt;
        const shape = getShapeById(this.shapeSequence[this.roundIndex] ?? "");
        if (!shape) return this.emit({ type: "error", code: "bad_frame", message: "unknown shape for this round" });

        // Empty submission - see the protocol note on ClientFrame["submit"].
        if (frame.path === null) {
          you.round = { score: 0, accuracy: 0, speed: 0, submittedAt: arrivedAt };
          if (this.everyoneSubmitted()) this.finishRound();
          else this.emitSnapshot();
          return;
        }

        const attempt = fromWirePath(frame.path);
        // Real scoring, exactly as the server does it: target generated at the
        // attempt's own canvas size so both live in one coordinate space.
        const accuracy = scoreAttempt(shape.generate(attempt.canvasWidth), attempt).total;
        const speed = arrivedAt > deadline ? 0 : Math.round(speedScore(arrivedAt - this.phaseStartsAt, MP_TIMINGS.DRAWING_MS));
        you.round = { score: combineRoundScore(accuracy, speed), accuracy, speed, submittedAt: arrivedAt };

        if (this.everyoneSubmitted()) this.finishRound();
        else this.emitSnapshot();
        return;
      }

      case "next":
        if (!you.isHost) return this.emit({ type: "error", code: "not_host", message: "only the host can do that" });
        if (this.phase !== "ROUND_RESULTS") return this.emit({ type: "error", code: "wrong_phase", message: "there is no round to advance from" });
        this.startRound(this.roundIndex + 1);
        return;

      case "rematch":
        if (!you.isHost) return this.emit({ type: "error", code: "not_host", message: "only the host can do that" });
        if (this.phase !== "FINAL_RESULTS") return this.emit({ type: "error", code: "wrong_phase", message: "the game is not finished" });
        this.clearTimers();
        this.roundIndex = -1;
        this.shapeSequence = [];
        this.lastRound = null;
        this.championSeatId = null;
        for (const p of this.players) {
          p.totalScore = 0;
          p.round = null;
        }
        this.enterPhase("LOBBY", null);
        return;

      case "setNickname":
        you.nickname = frame.nickname;
        this.emitSnapshot();
        return;

      case "join":
        // The harness is already "joined" by construction.
        this.emit({ type: "joined", seatId: YOU_SEAT, playerToken: "fake-token", roomCode: this.roomCode, serverNow: this.now() });
        this.emitSnapshot();
        return;
    }
  }

  subscribe(listener: (frame: ServerFrame) => void): () => void {
    this.listeners.add(listener);
    // Replay current state so a screen mounting mid-game renders immediately.
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.listeners.clear();
  }
}

/** Room codes for the harness use the same alphabet as the real ones, so the UI is exercised with realistic text. */
export function fakeRoomCode(random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < MP_LIMITS.ROOM_CODE_LENGTH; i++) code += alphabet[Math.floor(random() * alphabet.length)];
  return code;
}
