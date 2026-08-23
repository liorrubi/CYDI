import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTimedPhase,
  beginTurn,
  canDrawNow,
  champions,
  cleanPlayerName,
  createPassPlayGame,
  currentPlayer,
  duplicateNameIndex,
  nextPlayer,
  finishGame,
  isLastRound,
  nextRound,
  rematch,
  roundWinners,
  scoreTurn,
  showsTargetShape,
  standings,
  standingsVisible,
  submitTurn,
  turnOrder,
  visibleShapeId,
  type PassPlayState,
} from "./passPlayGame";
import { getShapeById } from "../engine/shapeLibrary";
import { MP_TIMINGS } from "../multiplayer/protocol";
import type { DrawingPath } from "../types/Challenge";

/** A deterministic "random" so a test never depends on which shapes were drawn. */
function fixedRandom(): () => number {
  let i = 0;
  return () => ((i++ * 7919) % 1000) / 1000;
}

function newGame(rounds: 5 | 10 | 15 = 5): PassPlayState {
  return createPassPlayGame({ names: ["Maya", "Tom"], rounds, difficulty: "mixed" }, fixedRandom());
}

/** A drawing that traces the round's own target, so accuracy is genuinely high. */
function perfectAttempt(state: PassPlayState): DrawingPath {
  const shape = getShapeById(state.shapeSequence[state.roundIndex])!;
  return shape.generate(320);
}

const SCRIBBLE: DrawingPath = {
  points: [
    { x: 10, y: 10 },
    { x: 300, y: 20 },
    { x: 20, y: 300 },
  ],
  canvasWidth: 320,
  canvasHeight: 320,
};

/** Plays one whole turn: handoff tap, countdown, look at the shape, draw, submit. */
function playTurn(state: PassPlayState, path: DrawingPath | null, drawMs = 5_000): PassPlayState {
  let now = 1_000_000;
  let s = beginTurn(state, now);
  now += MP_TIMINGS.COUNTDOWN_MS;
  s = advanceTimedPhase(s, now);
  now += MP_TIMINGS.SHOW_SHAPE_MS;
  s = advanceTimedPhase(s, now);
  assert.equal(s.phase, "DRAWING");
  return submitTurn(s, path, now + drawMs);
}

// ------------------------------------------------------------ turn order ---

test("turn order alternates who starts, round by round", () => {
  assert.deepEqual(turnOrder(2, 0), [0, 1]);
  assert.deepEqual(turnOrder(2, 1), [1, 0]);
  assert.deepEqual(turnOrder(2, 2), [0, 1]);
});

test("turn order stays a fair rotation with more than two players", () => {
  assert.deepEqual(turnOrder(3, 0), [0, 1, 2]);
  assert.deepEqual(turnOrder(3, 1), [1, 2, 0]);
  assert.deepEqual(turnOrder(3, 2), [2, 0, 1]);
  assert.deepEqual(turnOrder(4, 5), [1, 2, 3, 0]);
});

test("every player starts a round equally often over a full rotation", () => {
  const starts = new Map<number, number>();
  for (let round = 0; round < 12; round++) {
    const first = turnOrder(4, round)[0];
    starts.set(first, (starts.get(first) ?? 0) + 1);
  }
  assert.deepEqual([...starts.values()], [3, 3, 3, 3]);
});

// -------------------------------------------------------------- creation ---

test("a new game starts on a handoff with the first player up and nothing revealed", () => {
  const game = newGame();
  assert.equal(game.phase, "HANDOFF");
  assert.equal(currentPlayer(game)?.name, "Maya");
  assert.equal(nextPlayer(game)?.name, "Tom");
  assert.equal(game.phaseEndsAt, null);
  assert.equal(standingsVisible(game.phase), false);
  assert.deepEqual(game.players.map((p) => p.totalScore), [0, 0]);
});

test("the shape sequence is fixed up front, one distinct shape per round", () => {
  const game = newGame(10);
  assert.equal(game.shapeSequence.length, 10);
  assert.equal(new Set(game.shapeSequence).size, 10);
  for (const id of game.shapeSequence) assert.ok(getShapeById(id), `${id} is not a real shape`);
});

test("both players draw the same shape in a round", () => {
  let game = newGame();
  const shapeId = game.shapeSequence[0];
  game = beginTurn(game, 0);
  game = advanceTimedPhase(game, MP_TIMINGS.COUNTDOWN_MS);
  assert.equal(visibleShapeId(game), shapeId);

  game = playTurn(newGame(), SCRIBBLE);
  assert.equal(game.phase, "HANDOFF");
  assert.equal(currentPlayer(game)?.name, "Tom");
  game = beginTurn(game, 0);
  game = advanceTimedPhase(game, MP_TIMINGS.COUNTDOWN_MS);
  assert.equal(visibleShapeId(game), shapeId, "the second player must get the first player's shape");
});

test("names are trimmed, capped and never empty, and duplicates are caught", () => {
  assert.equal(cleanPlayerName("  Maya  ", 0), "Maya");
  assert.equal(cleanPlayerName("", 1), "Player 2");
  assert.equal(cleanPlayerName("a".repeat(40), 0).length, 16);
  assert.equal(duplicateNameIndex(["Maya", "Tom"]), -1);
  assert.equal(duplicateNameIndex(["Sam", " sam "]), 1);
  assert.equal(duplicateNameIndex(["", ""]), -1, "two blanks become Player 1 and Player 2, which are distinct");
});

// ----------------------------------------------------------- phase timing ---

test("the timed phases run for exactly as long as Play Together's", () => {
  let game = newGame();
  game = beginTurn(game, 1000);
  assert.equal(game.phase, "COUNTDOWN");
  assert.equal(game.phaseEndsAt, 1000 + MP_TIMINGS.COUNTDOWN_MS);

  game = advanceTimedPhase(game, game.phaseEndsAt!);
  assert.equal(game.phase, "SHOW_SHAPE");
  assert.equal(game.phaseEndsAt! - 1000 - MP_TIMINGS.COUNTDOWN_MS, MP_TIMINGS.SHOW_SHAPE_MS);

  game = advanceTimedPhase(game, game.phaseEndsAt!);
  assert.equal(game.phase, "DRAWING");
  assert.equal(game.phaseEndsAt! - game.drawingStartedAt!, 20_000);
});

test("a timed phase does not advance before its deadline", () => {
  let game = beginTurn(newGame(), 1000);
  game = advanceTimedPhase(game, 1000 + MP_TIMINGS.COUNTDOWN_MS - 1);
  assert.equal(game.phase, "COUNTDOWN");
});

test("DRAWING never advances on the clock - only a submission ends a turn", () => {
  let game = beginTurn(newGame(), 0);
  game = advanceTimedPhase(game, MP_TIMINGS.COUNTDOWN_MS);
  game = advanceTimedPhase(game, MP_TIMINGS.COUNTDOWN_MS + MP_TIMINGS.SHOW_SHAPE_MS);
  assert.equal(game.phase, "DRAWING");
  assert.equal(advanceTimedPhase(game, game.phaseEndsAt! + 10_000).phase, "DRAWING");
});

// ------------------------------------------------------------- the secret ---

test("the first player's score is not revealed while the second is still to draw", () => {
  const game = playTurn(newGame(), perfectAttempt(newGame()));

  assert.equal(game.phase, "HANDOFF");
  assert.equal(standingsVisible(game.phase), false, "nothing score-shaped may be on screen during a handoff");
  assert.equal(visibleShapeId(game), null, "and the shape is hidden until the next player has tapped through");
  // The turn HAS been scored - it just is not visible yet.
  assert.ok((game.players[0].round?.score ?? 0) > 0);
  // Totals do not move until the round closes, so even a leaked standings
  // table would show nothing about the turn just played.
  assert.deepEqual(game.players.map((p) => p.totalScore), [0, 0]);
});

test("standings become visible only once every player has taken their turn", () => {
  for (const phase of ["HANDOFF", "COUNTDOWN", "SHOW_SHAPE", "DRAWING"] as const) {
    assert.equal(standingsVisible(phase), false, phase);
  }
  assert.equal(standingsVisible("ROUND_RESULTS"), true);
  assert.equal(standingsVisible("FINAL_RESULTS"), true);
});

test("the canvas is locked outside the drawing window and once a submission is in flight", () => {
  assert.equal(canDrawNow("DRAWING", false), true);
  assert.equal(canDrawNow("DRAWING", true), false);
  for (const phase of ["HANDOFF", "COUNTDOWN", "SHOW_SHAPE", "ROUND_RESULTS", "FINAL_RESULTS"] as const) {
    assert.equal(canDrawNow(phase, false), false, phase);
    assert.equal(showsTargetShape(phase), phase === "SHOW_SHAPE" ? true : false, phase);
  }
});

// ---------------------------------------------------------------- scoring ---

test("scoring a turn uses the shared engine and the 75/25 split", () => {
  const game = newGame();
  const target = getShapeById(game.shapeSequence[0])!.generate(320);
  const result = scoreTurn(game.shapeSequence[0], target, 0);

  assert.ok(result.accuracy > 95, `a traced shape should score high, got ${result.accuracy}`);
  assert.equal(result.speed, 100, "submitting instantly is full speed");
  assert.equal(result.score, Math.round(result.accuracy * 0.75 + 100 * 0.25));
});

test("speed decays linearly across the 20-second window and bottoms out at zero", () => {
  const game = newGame();
  const target = getShapeById(game.shapeSequence[0])!.generate(320);
  assert.equal(scoreTurn(game.shapeSequence[0], target, 10_000).speed, 50);
  assert.equal(scoreTurn(game.shapeSequence[0], target, 20_000).speed, 0);
  assert.equal(scoreTurn(game.shapeSequence[0], target, 25_000).speed, 0);
});

test("an empty canvas at 0s is a real zero, not a missing turn", () => {
  const game = playTurn(newGame(), null, MP_TIMINGS.DRAWING_MS);
  assert.deepEqual(game.players[0].round, { score: 0, accuracy: 0, speed: 0, path: null });
  assert.equal(game.phase, "HANDOFF", "the round still moves on");
});

// ------------------------------------------------ drawings for comparison ---

test("a submitted drawing is kept with its score, so the round can be compared", () => {
  const start = newGame();
  const drawn = perfectAttempt(start);
  const game = playTurn(start, drawn, 3_000);
  assert.deepEqual(game.players[0].round?.path, drawn, "the exact path they drew");
  assert.equal(game.players[1].round, null, "and nothing at all for the player still to go");
});

test("both drawings are available once the round closes", () => {
  let game = newGame();
  game = playTurn(game, perfectAttempt(game), 2_000);
  game = playTurn(game, SCRIBBLE, 9_000);
  assert.equal(game.phase, "ROUND_RESULTS");
  assert.ok(game.players[0].round?.path, "first player's drawing");
  assert.deepEqual(game.players[1].round?.path, SCRIBBLE, "second player's drawing");
});

test("a drawing never outlives the round it belongs to", () => {
  // Local-only and transient: the comparison needs it for one screen, and
  // nothing persists it. The next round starts with both slots empty.
  let game = newGame();
  game = playTurn(game, perfectAttempt(game), 2_000);
  game = playTurn(game, SCRIBBLE, 9_000);
  game = nextRound(game);
  assert.deepEqual(game.players.map((p) => p.round), [null, null]);
});

test("a rematch carries no drawings over from the previous game", () => {
  let game = newGame(5);
  game = playTurn(game, perfectAttempt(game), 2_000);
  game = playTurn(game, SCRIBBLE, 9_000);
  const again = rematch({ ...game, phase: "FINAL_RESULTS" }, () => 0.42);
  assert.deepEqual(again.players.map((p) => p.round), [null, null]);
});

test("the drawing is not visible before the second player has finished", () => {
  // Held in state, but `standingsVisible` is what the UI gates every
  // score-shaped thing on - the comparison included.
  const game = playTurn(newGame(), perfectAttempt(newGame()), 2_000);
  assert.equal(game.phase, "HANDOFF");
  assert.ok(game.players[0].round?.path, "recorded");
  assert.equal(standingsVisible(game.phase), false, "but nothing may be shown yet");
});

test("a single stray dot is treated as an empty canvas rather than scored", () => {
  const game = newGame();
  const dot: DrawingPath = { points: [{ x: 5, y: 5 }], canvasWidth: 320, canvasHeight: 320 };
  assert.deepEqual(scoreTurn(game.shapeSequence[0], dot, 1000), { score: 0, accuracy: 0, speed: 0 });
});

// ----------------------------------------------------------- round close ----

test("closing a round adds the turn scores to the totals and names a winner", () => {
  let game = newGame();
  const good = perfectAttempt(game);
  game = playTurn(game, good, 2_000);
  game = playTurn(game, SCRIBBLE, 15_000);

  assert.equal(game.phase, "ROUND_RESULTS");
  assert.equal(standingsVisible(game.phase), true);
  assert.deepEqual(
    game.players.map((p) => p.totalScore),
    game.players.map((p) => p.round!.score),
  );
  assert.deepEqual(roundWinners(game).map((p) => p.name), ["Maya"]);
  assert.equal(standings(game)[0].name, "Maya");
});

test("an equal round score is a tie, not a prize for going first", () => {
  // Both draw nothing: identical scores, and the player who went first must not
  // win on submission order the way Play Together would decide it.
  let game = newGame();
  game = playTurn(game, null, MP_TIMINGS.DRAWING_MS);
  game = playTurn(game, null, MP_TIMINGS.DRAWING_MS);
  assert.deepEqual(roundWinners(game), [], "nobody scored, so nobody won the round");

  // And a genuine, non-zero tie names both.
  const tied: PassPlayState = {
    ...game,
    phase: "ROUND_RESULTS",
    players: game.players.map((p) => ({ ...p, round: { score: 61, accuracy: 70, speed: 34 } })),
    lastRound: { roundIndex: 0, shapeId: game.shapeSequence[0], winnerIds: ["p0", "p1"] },
  };
  assert.deepEqual(roundWinners(tied).map((p) => p.name), ["Maya", "Tom"]);
});

test("the next round resets the per-round results but keeps the totals", () => {
  let game = newGame();
  game = playTurn(game, perfectAttempt(game), 2_000);
  game = playTurn(game, SCRIBBLE, 15_000);
  const totals = game.players.map((p) => p.totalScore);

  game = nextRound(game);
  assert.equal(game.phase, "HANDOFF");
  assert.equal(game.roundIndex, 1);
  assert.equal(game.turnPosition, 0);
  assert.deepEqual(game.players.map((p) => p.round), [null, null]);
  assert.deepEqual(game.players.map((p) => p.totalScore), totals);
  assert.equal(currentPlayer(game)?.name, "Tom", "round 2 starts with the other player");
});

// ------------------------------------------------------------- whole game ---

test("a full five-round game ends on FINAL_RESULTS with a champion", () => {
  let game = newGame(5);
  for (let round = 0; round < 5; round++) {
    // Whoever is up first this round draws well; the other scribbles. Because
    // the order alternates, that is not the same person every round.
    game = playTurn(game, perfectAttempt(game), 3_000);
    game = playTurn(game, SCRIBBLE, 12_000);
    // EVERY round ends in its own results screen, the last one included - that
    // is where the two drawings get compared.
    assert.equal(game.phase, "ROUND_RESULTS", `round ${round + 1}`);
    if (round < 4) game = nextRound(game);
  }

  assert.equal(isLastRound(game), true);
  assert.equal(nextRound(game), game, "there is no next round to go to");
  game = finishGame(game);

  assert.equal(game.phase, "FINAL_RESULTS");
  assert.equal(game.roundIndex, 4);
  assert.equal(champions(game).length, 1);
  const totals = game.players.map((p) => p.totalScore);
  assert.equal(champions(game)[0].totalScore, Math.max(...totals));
  assert.equal(standings(game)[0].id, champions(game)[0].id);
});

test("a game where nobody ever scored has no champion rather than an arbitrary one", () => {
  let game = newGame(5);
  for (let round = 0; round < 5; round++) {
    game = playTurn(game, null, MP_TIMINGS.DRAWING_MS);
    game = playTurn(game, null, MP_TIMINGS.DRAWING_MS);
    if (round < 4) game = nextRound(game);
  }
  game = finishGame(game);
  assert.equal(game.phase, "FINAL_RESULTS");
  assert.deepEqual(champions(game), []);
});

test("a rematch keeps the players and settings, resets the scores and redraws the shapes", () => {
  let game = newGame(5);
  game = playTurn(game, perfectAttempt(game), 2_000);
  game = playTurn(game, SCRIBBLE, 9_000);

  const again = rematch({ ...game, phase: "FINAL_RESULTS" }, () => 0.42);
  assert.equal(again.phase, "HANDOFF");
  assert.equal(again.roundIndex, 0);
  assert.deepEqual(again.players.map((p) => p.name), ["Maya", "Tom"]);
  assert.deepEqual(again.players.map((p) => p.totalScore), [0, 0]);
  assert.deepEqual(again.players.map((p) => p.round), [null, null]);
  assert.equal(again.rounds, 5);
  assert.equal(again.difficulty, "mixed");
  assert.equal(again.shapeSequence.length, 5);
});

// -------------------------------------------------------------- guardrails --

test("transitions ignore actions that do not belong to the current phase", () => {
  const game = newGame();
  assert.equal(nextRound(game), game, "no next round from a handoff");
  assert.equal(submitTurn(game, SCRIBBLE, 0), game, "no submitting outside the drawing window");
  const drawing = advanceTimedPhase(
    advanceTimedPhase(beginTurn(game, 0), MP_TIMINGS.COUNTDOWN_MS),
    MP_TIMINGS.COUNTDOWN_MS + MP_TIMINGS.SHOW_SHAPE_MS,
  );
  assert.equal(beginTurn(drawing, 0), drawing, "no re-starting a turn that is under way");
});

test("the engine is written over a player list, so three and four players work unchanged", () => {
  let game = createPassPlayGame(
    { names: ["Maya", "Tom", "Dana"], rounds: 5, difficulty: "mixed" },
    fixedRandom(),
  );
  assert.equal(currentPlayer(game)?.name, "Maya");
  game = playTurn(game, SCRIBBLE, 4_000);
  assert.equal(currentPlayer(game)?.name, "Tom");
  game = playTurn(game, SCRIBBLE, 4_000);
  assert.equal(game.phase, "HANDOFF", "still one player to go");
  assert.equal(currentPlayer(game)?.name, "Dana");
  game = playTurn(game, SCRIBBLE, 4_000);
  assert.equal(game.phase, "ROUND_RESULTS");
  assert.equal(standings(game).length, 3);
});

// ------------------------------------------- the last round keeps its screen ---

test("the last round shows its own results before the champion screen", () => {
  let game = newGame(5);
  for (let round = 0; round < 4; round++) {
    game = playTurn(game, perfectAttempt(game), 3_000);
    game = playTurn(game, SCRIBBLE, 12_000);
    game = nextRound(game);
  }
  // Round five.
  const drawn = perfectAttempt(game);
  game = playTurn(game, drawn, 3_000);
  game = playTurn(game, SCRIBBLE, 12_000);

  assert.equal(game.phase, "ROUND_RESULTS", "not straight to the champion");
  assert.equal(isLastRound(game), true);
  assert.ok(game.lastRound, "with a round to show");
  assert.deepEqual(game.players[0].round?.path, drawn, "and both drawings still available to compare");
  assert.ok(game.players[1].round?.path);
  assert.deepEqual(champions(game), [], "the champion is not decided until the player asks for it");
});

test("only finishGame ends the game, and only from the last round's results", () => {
  let game = newGame(5);
  game = playTurn(game, perfectAttempt(game), 3_000);
  game = playTurn(game, SCRIBBLE, 12_000);
  assert.equal(game.phase, "ROUND_RESULTS");
  assert.equal(finishGame(game), game, "round one cannot end the game");

  for (let round = 1; round < 5; round++) {
    game = nextRound(game);
    game = playTurn(game, perfectAttempt(game), 3_000);
    game = playTurn(game, SCRIBBLE, 12_000);
  }
  const ended = finishGame(game);
  assert.equal(ended.phase, "FINAL_RESULTS");
  assert.equal(ended.championIds.length, 1);
  assert.equal(finishGame(ended), ended, "and it cannot be run twice");
});
