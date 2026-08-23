/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Pass & Play - the whole local game, as a pure state machine.
//
// No React, no networking, no storage: every transition is a function from a
// state and a timestamp to a new state. That is not ceremony, it is what makes
// the one rule this mode lives or dies by testable without a browser - a player
// must never see anyone else's drawing or score before everybody has taken
// their turn (see `standingsVisible`).
//
// WHY IT IMPORTS FROM multiplayer/protocol
// The 20-second window, the 3-second look, the round-count and difficulty
// options and the 75/25 accuracy-speed split are the rules of CYDI's
// competitive play, not of the transport. Play Together happens to define them
// in its wire contract because the Worker needs them too; duplicating them here
// would mean a future change to the drawing window silently applied to one mode
// and not the other. protocol.ts is dependency-free by design, so importing it
// costs nothing.
//
// PLAYERS ARE A LIST, ALWAYS
// v1 ships a two-player UI, but nothing below knows that. Turn order, scoring,
// round closing, ties and the champion are all written over `players[]`, so
// raising the cap to 3 or 4 is a change to the setup screen and the seat
// validation, not to the game.
import { scoreAttempt } from "../engine/scoring";
import { getShapeById } from "../engine/shapeLibrary";
import { pickShapeSequence } from "../multiplayer/difficultyPool";
import {
  combineRoundScore,
  MP_TIMINGS,
  speedScore,
  type MultiplayerDifficulty,
  type RoundCount,
} from "../multiplayer/protocol";
import type { DrawingPath } from "../types/Challenge";

// ----------------------------------------------------------------- limits ---

export const PASS_PLAY_LIMITS = {
  /** Two is the v1 product decision. The engine has no opinion; the setup screen enforces it. */
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  MAX_NAME_LENGTH: 16,
} as const;

// ----------------------------------------------------------------- phases ---

/**
 * There is no LOBBY and no ROUND_RESULTS-for-the-last-round, both deliberately:
 *
 *   HANDOFF -> COUNTDOWN -> SHOW_SHAPE -> DRAWING -+-> HANDOFF (next player)
 *      ^                                           |
 *      +------- ROUND_RESULTS <--------------------+ (last player of the round)
 *                                                  |
 *                       last round -> FINAL_RESULTS+
 *
 * HANDOFF is the beat that makes the mode work on one device: it names whose
 * turn it is and waits for a tap, so nobody's shape appears while the phone is
 * still in the other player's hand. It is also the only pause in the loop - the
 * three timed phases run exactly as long as they do in Play Together.
 *
 * The last round skips ROUND_RESULTS and goes straight to FINAL_RESULTS, which
 * is what the server does (worker/roomDO.ts finishRound), so the two modes end
 * the same way.
 */
export const PASS_PLAY_PHASES = [
  "HANDOFF",
  "COUNTDOWN",
  "SHOW_SHAPE",
  "DRAWING",
  "ROUND_RESULTS",
  "FINAL_RESULTS",
] as const;
export type PassPlayPhase = (typeof PASS_PLAY_PHASES)[number];

/** Phases that end on a clock. Every other phase waits for a player to tap. */
export const PASS_PLAY_TIMED_PHASES: ReadonlySet<PassPlayPhase> = new Set<PassPlayPhase>([
  "COUNTDOWN",
  "SHOW_SHAPE",
  "DRAWING",
]);

// ------------------------------------------------------------------ state ---

export type TurnResult = {
  /** The combined 75/25 score, which is what counts towards the total. */
  score: number;
  accuracy: number;
  speed: number;
};

export type PassPlayPlayer = {
  /** Stable for the life of the game. Not an array index: turn order rotates. */
  id: string;
  name: string;
  totalScore: number;
  /** This round's result, or null until this player has taken their turn in it. */
  round: TurnResult | null;
};

export type PassPlayState = {
  /**
   * Unique to this match, minted when it is created.
   *
   * The idempotency key for its Social Points award: a rematch builds a whole
   * new state and therefore a new id, so finishing it earns again, while every
   * re-render, remount and revisit of the SAME finished match sees the same id
   * and pays nothing.
   */
  gameId: string;
  phase: PassPlayPhase;
  players: PassPlayPlayer[];
  rounds: number;
  difficulty: MultiplayerDifficulty;
  /** One shape id per round, fixed when the game is created so both players draw the same thing. */
  shapeSequence: string[];
  roundIndex: number;
  /** Position within THIS round's turn order - not an index into `players`. */
  turnPosition: number;
  /** Local wall-clock deadline for a timed phase, or null while waiting for a tap. */
  phaseEndsAt: number | null;
  /** When the current DRAWING phase began, which is what the speed score is measured from. */
  drawingStartedAt: number | null;
  lastRound: { roundIndex: number; shapeId: string; winnerIds: string[] } | null;
  /** Ids of the top scorer(s) once the game is over. Empty when nobody scored. */
  championIds: string[];
};

export type PassPlaySetup = {
  names: string[];
  rounds: RoundCount;
  difficulty: MultiplayerDifficulty;
};

// ------------------------------------------------------------- turn order ---

/**
 * Who plays when, in round `roundIndex`.
 *
 * Rotated by the round number so the disadvantage of going first - drawing
 * before you have seen anyone else's result, with no idea what score you need -
 * moves around instead of always landing on the same person. With two players
 * that is a straight alternation, which is what the mode promises; with three
 * or four it stays a fair rotation without any extra code.
 */
export function turnOrder(playerCount: number, roundIndex: number): number[] {
  if (playerCount <= 0) return [];
  const offset = ((roundIndex % playerCount) + playerCount) % playerCount;
  return Array.from({ length: playerCount }, (_, i) => (i + offset) % playerCount);
}

export function currentPlayer(state: PassPlayState): PassPlayPlayer | null {
  const order = turnOrder(state.players.length, state.roundIndex);
  const index = order[state.turnPosition];
  return index === undefined ? null : state.players[index] ?? null;
}

/** The player who takes the turn after this one, or null when the current turn closes the round. */
export function nextPlayer(state: PassPlayState): PassPlayPlayer | null {
  const order = turnOrder(state.players.length, state.roundIndex);
  const index = order[state.turnPosition + 1];
  return index === undefined ? null : state.players[index] ?? null;
}

// ----------------------------------------------------------------- naming ---

/** Trimmed, length-capped, and never empty - an unnamed seat still has to be addressable on the handoff card. */
export function cleanPlayerName(raw: string, seat: number): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, PASS_PLAY_LIMITS.MAX_NAME_LENGTH);
  return trimmed || `Player ${seat + 1}`;
}

/**
 * Why two identical names are rejected rather than silently disambiguated:
 * every screen in this mode - the handoff card most of all - identifies whose
 * turn it is by name alone. "Sam, your turn" has to mean one person.
 */
export function duplicateNameIndex(names: string[]): number {
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const key = cleanPlayerName(names[i], i).toLocaleLowerCase();
    if (seen.has(key)) return i;
    seen.add(key);
  }
  return -1;
}

// --------------------------------------------------------------- creation ---

function newGameId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Ancient WebView without randomUUID. Uniqueness per device is all this
    // needs - it is never sent anywhere and never compared across devices.
    return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createPassPlayGame(setup: PassPlaySetup, random: () => number = Math.random): PassPlayState {
  const players: PassPlayPlayer[] = setup.names.map((name, seat) => ({
    id: `p${seat}`,
    name: cleanPlayerName(name, seat),
    totalScore: 0,
    round: null,
  }));

  return {
    gameId: newGameId(),
    phase: "HANDOFF",
    players,
    rounds: setup.rounds,
    difficulty: setup.difficulty,
    // Fixed up front, not drawn per round: both players must face the same
    // shape in a round, and picking lazily would make that a timing question.
    shapeSequence: pickShapeSequence(setup.difficulty, setup.rounds, random),
    roundIndex: 0,
    turnPosition: 0,
    phaseEndsAt: null,
    drawingStartedAt: null,
    lastRound: null,
    championIds: [],
  };
}

// ---------------------------------------------------------------- scoring ---

/**
 * Scores one turn with the single-player engine, exactly as the Worker does.
 *
 * The target is generated at the ATTEMPT's own canvas width so both paths share
 * a coordinate space - the same reason worker/roomDO.ts does it, and it matters
 * for the scale component, which compares raw bounding-box diagonals.
 *
 * An empty canvas is a real zero, not a missing result: the player took their
 * turn and drew nothing, which is a score, and the round still closes.
 */
export function scoreTurn(shapeId: string, path: DrawingPath | null, elapsedMs: number): TurnResult {
  if (!path || path.points.length < 2) return { score: 0, accuracy: 0, speed: 0 };
  const shape = getShapeById(shapeId);
  if (!shape) return { score: 0, accuracy: 0, speed: 0 };

  const target = shape.generate(path.canvasWidth);
  const accuracy = scoreAttempt(target, path).total;
  // Rounded BEFORE combining, so the three numbers shown to the player add up.
  // Same fix, same reason as roomDO.scoreSubmission.
  const speed = Math.round(speedScore(Math.max(0, elapsedMs), MP_TIMINGS.DRAWING_MS));
  return { score: combineRoundScore(accuracy, speed), accuracy, speed };
}

/** The ids holding the highest value, or [] when the best anyone managed was zero. */
function leadersBy(players: PassPlayPlayer[], value: (p: PassPlayPlayer) => number): string[] {
  let best = 0;
  for (const p of players) best = Math.max(best, value(p));
  if (best <= 0) return [];
  return players.filter((p) => value(p) === best).map((p) => p.id);
}

/**
 * Ties are real ties here, unlike Play Together, which breaks them by who
 * submitted first. That tiebreak is meaningless on one device: turns are
 * sequential, so the player who went first ALWAYS submitted first, and a
 * "winner" chosen that way would just be a turn-order prize.
 */
function closeRound(state: PassPlayState): PassPlayState {
  const players = state.players.map((p) => ({ ...p, totalScore: p.totalScore + (p.round?.score ?? 0) }));
  const winnerIds = leadersBy(state.players, (p) => p.round?.score ?? 0);
  const lastRound = {
    roundIndex: state.roundIndex,
    shapeId: state.shapeSequence[state.roundIndex] ?? "",
    winnerIds,
  };

  const isLastRound = state.roundIndex >= state.rounds - 1;
  return {
    ...state,
    players,
    phase: isLastRound ? "FINAL_RESULTS" : "ROUND_RESULTS",
    phaseEndsAt: null,
    drawingStartedAt: null,
    lastRound,
    championIds: isLastRound ? leadersBy(players, (p) => p.totalScore) : [],
  };
}

// ------------------------------------------------------------ transitions ---

/** HANDOFF -> COUNTDOWN. The tap that says the right person is now holding the device. */
export function beginTurn(state: PassPlayState, now: number): PassPlayState {
  if (state.phase !== "HANDOFF") return state;
  return { ...state, phase: "COUNTDOWN", phaseEndsAt: now + MP_TIMINGS.COUNTDOWN_MS, drawingStartedAt: null };
}

/**
 * Runs the timed phases forward when their deadline passes.
 *
 * DRAWING is not advanced here: it ends by submission (`submitTurn`), including
 * the automatic one the UI fires at 0s with whatever is on the canvas. Having a
 * single exit keeps "every turn produces a score" true by construction.
 */
export function advanceTimedPhase(state: PassPlayState, now: number): PassPlayState {
  if (state.phaseEndsAt === null || now < state.phaseEndsAt) return state;
  if (state.phase === "COUNTDOWN") {
    return { ...state, phase: "SHOW_SHAPE", phaseEndsAt: now + MP_TIMINGS.SHOW_SHAPE_MS };
  }
  if (state.phase === "SHOW_SHAPE") {
    return { ...state, phase: "DRAWING", phaseEndsAt: now + MP_TIMINGS.DRAWING_MS, drawingStartedAt: now };
  }
  return state;
}

/**
 * Ends the current turn: scores it, then either hands the device on or closes
 * the round.
 *
 * `path` is null when the clock ran out on an empty canvas.
 */
export function submitTurn(state: PassPlayState, path: DrawingPath | null, now: number): PassPlayState {
  if (state.phase !== "DRAWING") return state;
  const player = currentPlayer(state);
  if (!player) return state;

  const elapsed = state.drawingStartedAt === null ? MP_TIMINGS.DRAWING_MS : now - state.drawingStartedAt;
  const result = scoreTurn(state.shapeSequence[state.roundIndex] ?? "", path, elapsed);
  const players = state.players.map((p) => (p.id === player.id ? { ...p, round: result } : p));

  const scored: PassPlayState = { ...state, players, phaseEndsAt: null, drawingStartedAt: null };

  // More turns left in this round: hand over WITHOUT revealing anything.
  if (state.turnPosition + 1 < state.players.length) {
    return { ...scored, phase: "HANDOFF", turnPosition: state.turnPosition + 1 };
  }
  return closeRound(scored);
}

/** ROUND_RESULTS -> the next round's first handoff. */
export function nextRound(state: PassPlayState): PassPlayState {
  if (state.phase !== "ROUND_RESULTS") return state;
  return {
    ...state,
    phase: "HANDOFF",
    roundIndex: state.roundIndex + 1,
    turnPosition: 0,
    phaseEndsAt: null,
    drawingStartedAt: null,
    players: state.players.map((p) => ({ ...p, round: null })),
    lastRound: null,
  };
}

/** FINAL_RESULTS -> a brand new game with the same people and settings, and a freshly drawn shape sequence. */
export function rematch(state: PassPlayState, random: () => number = Math.random): PassPlayState {
  return createPassPlayGame(
    {
      names: state.players.map((p) => p.name),
      rounds: state.rounds as RoundCount,
      difficulty: state.difficulty,
    },
    random,
  );
}

// -------------------------------------------------------------- UI rules ----
// Pulled out of the components for the same reason multiplayer/roomUiRules.ts
// is: each one is a single boolean whose failure is a visible, hard-to-notice
// bug, and every one of them can be pinned here without mounting React.

/** Whether the canvas accepts input. */
export function canDrawNow(phase: PassPlayPhase, submitting: boolean): boolean {
  return phase === "DRAWING" && !submitting;
}

/** The reference shape may be on screen for exactly one phase - never during the countdown, never while drawing. */
export function showsTargetShape(phase: PassPlayPhase): boolean {
  return phase === "SHOW_SHAPE";
}

/** The shape id the UI is allowed to render right now, or null. Enforces the rule above at the data level, not just in JSX. */
export function visibleShapeId(state: PassPlayState): string | null {
  if (!showsTargetShape(state.phase)) return null;
  return state.shapeSequence[state.roundIndex] ?? null;
}

/**
 * Whether ANY score, drawing or standing may be displayed.
 *
 * The core promise of pass & play: the second player must not learn what the
 * first one scored before drawing. Everything score-shaped in the UI is gated
 * on this, so the promise holds by construction rather than by remembering to
 * omit a panel from four different phases.
 */
export function standingsVisible(phase: PassPlayPhase): boolean {
  return phase === "ROUND_RESULTS" || phase === "FINAL_RESULTS";
}

/** "Round 3 of 10". */
export function roundLabel(roundIndex: number, rounds: number): string {
  return roundIndex >= 0 ? `Round ${roundIndex + 1} of ${rounds}` : "";
}

/** Players sorted for the standings table: highest total first, then by round score, then by seat so the order is stable. */
export function standings(state: PassPlayState): PassPlayPlayer[] {
  return [...state.players].sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      (b.round?.score ?? 0) - (a.round?.score ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

/** The named winner(s) of the last round, or [] when nobody scored. */
export function roundWinners(state: PassPlayState): PassPlayPlayer[] {
  const ids = state.lastRound?.winnerIds ?? [];
  return state.players.filter((p) => ids.includes(p.id));
}

export function champions(state: PassPlayState): PassPlayPlayer[] {
  return state.players.filter((p) => state.championIds.includes(p.id));
}
