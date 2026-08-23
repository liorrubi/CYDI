/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../Button";
import DrawingCanvas, { type DrawingCanvasHandle } from "../DrawingCanvas";
import MultiplayerLeaderboard, { type LeaderboardPlayer } from "../multiplayer/MultiplayerLeaderboard";
import MultiplayerTutorialOverlay from "../multiplayer/MultiplayerTutorialOverlay";
import RoundCoachMark from "../multiplayer/RoundCoachMark";
import RoundTimer from "../multiplayer/RoundTimer";
import WinnerReveal from "../multiplayer/WinnerReveal";
import { CANVAS_SIZE } from "../../app/constants";
import { getShapeById } from "../../engine/shapeLibrary";
import { getSelectedColor } from "../../services/penColorStore";
import { playRoundStartSound } from "../../engine/soundEngine";
import { hapticRoundStart } from "../../services/haptics";
import { ScreenWakeLock } from "../../services/wakeLock";
import {
  markPassPlayRoundCoachShown,
  markPassPlayTutorialShown,
  shouldShowPassPlayRoundCoach,
  shouldShowPassPlayTutorial,
} from "../../services/multiplayerTutorialStore";
import { awardPassPlayMatch } from "../../services/socialPointsStore";
import { PASS_PLAY_MATCH_POINTS } from "../../social/socialRewards";
import { SocialPointsAward } from "../SocialPointsBadge";
import { trackEvent } from "../../services/analytics";
import { useDeadlineRemaining } from "../../multiplayer/useRoom";
import { MP_TIMINGS } from "../../multiplayer/protocol";
import {
  advanceTimedPhase,
  beginTurn,
  canDrawNow,
  champions,
  createPassPlayGame,
  currentPlayer,
  nextRound,
  rematch,
  roundLabel as formatRoundLabel,
  roundWinners,
  showsTargetShape,
  standings,
  submitTurn,
  visibleShapeId,
  type PassPlayPlayer,
  type PassPlaySetup,
  type PassPlayState,
} from "../../passplay/passPlayGame";
import type { DrawingPath } from "../../types/Challenge";

export type PassPlayProgress = {
  /** True from the first handoff until the champion screen. Drives the "Quit game?" confirmation in the screen above. */
  active: boolean;
  roundIndex: number;
  rounds: number;
  playerCount: number;
};

type PassPlayGameProps = {
  setup: PassPlaySetup;
  onExit: () => void;
  /** Reports how far the match has got, so the screen can guard navigation and report an abandon without owning the game state. */
  onProgress?: (progress: PassPlayProgress) => void;
};

/** The standings table is shared with Play Together, which thinks in seats; a local player id is the same kind of stable key. */
function toLeaderboardRow(player: PassPlayPlayer): LeaderboardPlayer {
  return {
    seatId: player.id,
    nickname: player.name,
    totalScore: player.totalScore,
    roundScore: player.round?.score ?? null,
    roundAccuracy: player.round?.accuracy ?? null,
    roundSpeed: player.round?.speed ?? null,
  };
}

function joinNames(players: PassPlayPlayer[]): string | null {
  if (players.length === 0) return null;
  if (players.length === 1) return players[0].name;
  return `${players.slice(0, -1).map((p) => p.name).join(", ")} & ${players[players.length - 1].name}`;
}

export default function PassPlayGame({ setup, onExit, onProgress }: PassPlayGameProps) {
  const [game, setGame] = useState<PassPlayState>(() => createPassPlayGame(setup));
  const remainingMs = useDeadlineRemaining(game.phaseEndsAt, 0);

  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const [attempt, setAttempt] = useState<DrawingPath | null>(null);
  /** Local echo of DONE, so the canvas locks on the tap rather than after the state update. */
  const [submitting, setSubmitting] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => shouldShowPassPlayTutorial());
  // First-round hints, on their own flag rather than Play Together's: passing a
  // phone back and forth is a different game from everyone drawing at once, and
  // having been walked through one is not having been shown the other.
  const [coachArmed] = useState(() => shouldShowPassPlayRoundCoach());
  const penColor = useMemo(() => getSelectedColor(), []);

  const { phase, roundIndex, turnPosition } = game;
  const player = currentPlayer(game);
  const turnKey = `${roundIndex}-${turnPosition}`;

  /**
   * Hold the screen awake for the whole game, exactly as a live room does.
   *
   * It matters more here, if anything: a player waiting out someone else's
   * 20-second turn is not touching the device at all, and a phone that locks
   * mid-handoff turns a friendly game into a passcode prompt.
   */
  useEffect(() => {
    let lock: ScreenWakeLock | null = null;
    let cancelled = false;
    void ScreenWakeLock.acquire().then((acquired) => {
      if (cancelled) void acquired.release();
      else lock = acquired;
    });
    return () => {
      cancelled = true;
      void lock?.release();
    };
  }, []);

  // Every turn starts from a blank canvas. The `key` below remounts it, which
  // is the structural half of this; clearing the tracked attempt is the other.
  useEffect(() => {
    setAttempt(null);
    setSubmitting(false);
  }, [turnKey]);

  useEffect(() => {
    setRevealDone(false);
  }, [roundIndex, phase]);

  useEffect(() => {
    if (coachArmed && roundIndex === 1) markPassPlayRoundCoachShown();
  }, [coachArmed, roundIndex]);

  useEffect(() => {
    onProgress?.({
      active: phase !== "FINAL_RESULTS",
      roundIndex: Math.max(0, roundIndex),
      rounds: game.rounds,
      playerCount: game.players.length,
    });
  }, [onProgress, phase, roundIndex, game.rounds, game.players.length]);

  // Run the countdown and the shape peek forward when their deadlines pass.
  useEffect(() => {
    if (remainingMs === null || remainingMs > 0) return;
    if (phase !== "COUNTDOWN" && phase !== "SHOW_SHAPE") return;
    setGame((current) => advanceTimedPhase(current, Date.now()));
  }, [remainingMs, phase]);

  // The draw cue: one tick and one tap, once per turn.
  const cueRef = useRef("");
  useEffect(() => {
    if (phase !== "DRAWING" || cueRef.current === turnKey) return;
    cueRef.current = turnKey;
    playRoundStartSound();
    hapticRoundStart();
  }, [phase, turnKey]);

  /** Turns this round that ran the clock out on an empty canvas - reported as `submitted: false`, never as a name or a score. */
  const emptyTurnsRef = useRef(0);
  useEffect(() => {
    emptyTurnsRef.current = 0;
  }, [roundIndex]);

  function handleDone(allowEmpty = false) {
    if (game.phase !== "DRAWING" || submitting) return;
    const drawn = attempt && attempt.points.length >= 2;
    if (!drawn && !allowEmpty) return;
    if (!drawn) emptyTurnsRef.current += 1;
    setSubmitting(true);
    setGame((current) => submitTurn(current, drawn ? attempt : null, Date.now()));
  }

  // At 0s the turn ends with whatever is on the canvas, empty included - the
  // same rule as a live room, and the reason a player who never picks up the
  // pen still scores a real zero instead of stalling the game.
  useEffect(() => {
    if (phase !== "DRAWING" || submitting) return;
    if (remainingMs === null || remainingMs > 0) return;
    /*
     * The deadline is re-read rather than trusted from `remainingMs`, which
     * lags one render behind a phase change: the tick that ran it down to 0
     * belonged to the EXPIRING SHOW_SHAPE deadline, and the render that starts
     * DRAWING still closes over that stale 0. Without this line the turn
     * auto-submits an empty canvas on the first frame of the drawing window -
     * which is exactly what it did the first time this ran in a browser.
     */
    if (game.phaseEndsAt === null || Date.now() < game.phaseEndsAt) return;
    handleDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, phase, submitting, game.phaseEndsAt]);

  // ------------------------------------------------------------- analytics --
  // Counts and settings only. There are two real people sitting next to each
  // other here, so a name in an event would be worse than in a live room, not
  // better - neither name ever leaves the device.
  const startReportedRef = useRef("");
  useEffect(() => {
    if (startReportedRef.current === game.gameId) return;
    startReportedRef.current = game.gameId;
    trackEvent("pp_game_started", {
      playerCount: game.players.length,
      roundCount: game.rounds,
      difficulty: game.difficulty,
    });
  }, [game.gameId, game.players.length, game.rounds, game.difficulty]);

  const roundReportedRef = useRef(-1);
  useEffect(() => {
    if (phase !== "ROUND_RESULTS" && phase !== "FINAL_RESULTS") return;
    if (roundReportedRef.current === roundIndex) return;
    roundReportedRef.current = roundIndex;
    trackEvent("pp_round_completed", {
      roundIndex,
      playerCount: game.players.length,
      submitted: emptyTurnsRef.current === 0,
    });
  }, [phase, roundIndex, game.players.length]);

  // ------------------------------------------------- Social Points award ----
  /**
   * Paid once, when the match is genuinely finished.
   *
   * Keyed on the match's own id, so a remount, a back/forward navigation or
   * simply re-rendering the champion screen cannot pay twice - and a rematch,
   * which mints a new id, can. Nothing is awarded for quitting part-way: this
   * effect is only ever reached from FINAL_RESULTS.
   */
  const [award, setAward] = useState<{ points: number; total: number } | null>(null);
  const finishedRef = useRef("");
  useEffect(() => {
    if (phase !== "FINAL_RESULTS" || finishedRef.current === game.gameId) return;
    finishedRef.current = game.gameId;
    trackEvent("pp_game_finished", { playerCount: game.players.length, roundCount: game.rounds });
    const result = awardPassPlayMatch(game.gameId, PASS_PLAY_MATCH_POINTS);
    setAward({ points: result.points, total: result.total });
  }, [phase, game.gameId, game.players.length, game.rounds]);

  const shapeId = visibleShapeId(game);
  const target = useMemo(() => (shapeId ? getShapeById(shapeId)?.generate(CANVAS_SIZE) : undefined), [shapeId]);

  const hasDrawn = (attempt?.points.length ?? 0) >= 2;
  const showCoach = coachArmed && roundIndex === 0;
  const roundLabel = formatRoundLabel(roundIndex, game.rounds);
  const rows = standings(game).map(toLeaderboardRow);

  function dismissTutorial() {
    markPassPlayTutorialShown();
    setShowTutorial(false);
  }

  return (
    <div className="mp-room pp-room">
      {showTutorial && <MultiplayerTutorialOverlay role="passPlay" onDismiss={dismissTutorial} />}

      {/* --------------------------------------------------------- HANDOFF -- */}
      {phase === "HANDOFF" && player && (
        <div className="mp-stage pp-handoff">
          <p className="mp-round-label">{roundLabel}</p>
          <div className="card pp-handoff-card">
            <span className="pp-handoff-avatar" aria-hidden="true">
              {player.name.slice(0, 1).toUpperCase()}
            </span>
            <h2 className="pp-handoff-title">{player.name}, your turn</h2>
            <p className="pp-handoff-sub">
              {turnPosition === 0
                ? "Hand the device over and tap when you're holding it."
                : "Pass the device across, then tap to start."}
            </p>
            {/*
              Said on every handoff, not just the first: this is the one rule
              that cannot be enforced in software. Nothing on this screen shows
              a score, so looking away is all that is left to ask for.
            */}
            <p className="mp-hint pp-handoff-hint">
              No scores yet — nobody sees anything until you have both drawn.
            </p>
            <Button className="mp-primary-action" onClick={() => setGame((c) => beginTurn(c, Date.now()))}>
              I&apos;m ready
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- COUNTDOWN -- */}
      {phase === "COUNTDOWN" && (
        <div className="mp-stage mp-stage-countdown">
          <p className="mp-round-label">{roundLabel}</p>
          <p className="mp-countdown-number" aria-live="assertive">
            {remainingMs === null ? "" : Math.max(1, Math.ceil(remainingMs / 1000))}
          </p>
          <p className="mp-stage-caption">Get ready, {player?.name}…</p>
        </div>
      )}

      {/* ------------------------------------------ SHOW_SHAPE and DRAWING -- */}
      {(phase === "SHOW_SHAPE" || phase === "DRAWING") && (
        <div className="mp-stage">
          <div className="mp-stage-header">
            <p className="mp-round-label">
              {roundLabel} · {player?.name}
            </p>
            {phase === "DRAWING" && <RoundTimer remainingMs={remainingMs} totalMs={MP_TIMINGS.DRAWING_MS} />}
          </div>

          {phase === "SHOW_SHAPE" && (
            <>
              <p className="mp-stage-caption mp-stage-caption-strong">
                Memorise it — it disappears in {remainingMs === null ? 3 : Math.max(1, Math.ceil(remainingMs / 1000))}s
              </p>
              {showCoach && <RoundCoachMark text="Remember this shape!" />}
            </>
          )}

          {phase === "DRAWING" && !submitting && (
            <>
              <p className="mp-stage-caption">Draw it from memory</p>
              {showCoach && !hasDrawn && <RoundCoachMark text="Draw it from memory — the shape is gone now!" />}
            </>
          )}

          {/*
            Keyed on the turn, so handing the device over remounts a genuinely
            blank canvas. Clearing an existing one would work right up until the
            day a clear() call is missed on some path, and the cost of that bug
            is the other player's drawing sitting on screen.
          */}
          <div className="canvas-wrapper mp-canvas-wrapper">
            <DrawingCanvas
              key={turnKey}
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              disabled={!canDrawNow(phase, submitting)}
              ghostPath={showsTargetShape(phase) ? target : undefined}
              showGhost={showsTargetShape(phase)}
              strokeColor={penColor}
              onChange={setAttempt}
              onComplete={setAttempt}
              ariaLabel={phase === "SHOW_SHAPE" ? "The shape to memorise" : "Draw the shape from memory"}
            />
          </div>

          {phase === "DRAWING" && !submitting && (
            <>
              <div className="button-row">
                <Button
                  variant="secondary"
                  onClick={() => canvasRef.current?.undoLastStroke()}
                  disabled={!attempt || attempt.points.length === 0}
                >
                  Undo
                </Button>
                <Button onClick={() => handleDone()} disabled={!hasDrawn}>
                  DONE
                </Button>
              </div>
              {showCoach && hasDrawn && (
                <RoundCoachMark text="Finished? Tap DONE — finishing early earns a speed bonus." />
              )}
            </>
          )}
        </div>
      )}

      {/* --------------------------------------------------- ROUND_RESULTS -- */}
      {phase === "ROUND_RESULTS" && (
        <div className="mp-stage">
          <p className="mp-round-label">{roundLabel}</p>
          {!revealDone ? (
            <WinnerReveal
              nickname={joinNames(roundWinners(game))}
              score={roundWinners(game)[0]?.round?.score ?? null}
              isYou={false}
              tie={roundWinners(game).length > 1}
              variant="round"
              onDone={() => setRevealDone(true)}
            />
          ) : (
            <>
              <MultiplayerLeaderboard
                players={rows}
                yourSeatId={null}
                highlightSeatIds={game.lastRound?.winnerIds ?? null}
              />
              {showCoach && (
                <RoundCoachMark text="Scores add up across every round — there's plenty of time to catch up." />
              )}
              <Button className="mp-primary-action" onClick={() => setGame(nextRound)}>
                Next Round
              </Button>
            </>
          )}
        </div>
      )}

      {/* --------------------------------------------------- FINAL_RESULTS -- */}
      {phase === "FINAL_RESULTS" && (
        <div className="mp-stage">
          {!revealDone ? (
            <WinnerReveal
              nickname={joinNames(champions(game))}
              score={champions(game)[0]?.totalScore ?? null}
              isYou={false}
              tie={champions(game).length > 1}
              variant="champion"
              onDone={() => setRevealDone(true)}
            />
          ) : (
            <>
              <h2 className="mp-final-heading">
                <span aria-hidden="true">👑</span>{" "}
                {champions(game).length === 0
                  ? "Final scores"
                  : champions(game).length > 1
                    ? `${joinNames(champions(game))} finish level`
                    : `${champions(game)[0].name} is the CYDI Champion`}
              </h2>
              <MultiplayerLeaderboard
                players={rows}
                yourSeatId={null}
                highlightSeatIds={game.championIds}
                showRoundScore={false}
              />
              {award && <SocialPointsAward points={award.points} total={award.total} />}
              <div className="button-row mp-final-actions">
                <Button variant="secondary" onClick={onExit}>
                  Exit
                </Button>
                <Button
                  onClick={() => {
                    trackEvent("pp_rematch", { playerCount: game.players.length });
                    setAward(null);
                    setGame((c) => rematch(c));
                  }}
                >
                  Play Again
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
