import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../Button";
import DrawingCanvas, { type DrawingCanvasHandle } from "../DrawingCanvas";
import MultiplayerLeaderboard from "./MultiplayerLeaderboard";
import RoomCodeCard from "./RoomCodeCard";
import RoundCoachMark from "./RoundCoachMark";
import RoundTimer from "./RoundTimer";
import WinnerReveal from "./WinnerReveal";
import MultiplayerTutorialOverlay from "./MultiplayerTutorialOverlay";
import { CANVAS_SIZE } from "../../app/constants";
import { getShapeById } from "../../content/contentRepository";
import { getSelectedColor } from "../../services/penColorStore";
import {
  markGuestTutorialShown,
  markHostTutorialShown,
  markRoundCoachShown,
  shouldShowGuestTutorial,
  shouldShowHostTutorial,
  shouldShowRoundCoach,
} from "../../services/multiplayerTutorialStore";
import { useDeadlineRemaining, useRoom } from "../../multiplayer/useRoom";
import { canDrawNow, hostControlFor, roundLabel as formatRoundLabel, showsTargetShape } from "../../multiplayer/roomUiRules";
import { playRoundStartSound } from "../../engine/soundEngine";
import { hapticRoundStart } from "../../services/haptics";
import { ScreenWakeLock } from "../../services/wakeLock";
import { trackEvent } from "../../services/analytics";
import { awardSocialPoints } from "../../services/socialPointsStore";
import { multiplayerAwardId, multiplayerAwards } from "../../social/socialRewards";
import { crossedRanks } from "../../social/socialRank";
import type { SocialRankParam } from "../../services/analyticsSchema";
import { SocialPointsAward } from "../SocialPointsBadge";
import SocialProgressCard from "../SocialProgressCard";
import { clearSocialPointsOverride, setSocialPointsOverride } from "../../social/socialPointsDisplay";
import {
  DIFFICULTY_OPTIONS,
  MP_LIMITS,
  MP_TIMINGS,
  ROUND_COUNT_OPTIONS,
  toWirePath,
  type MultiplayerDifficulty,
} from "../../multiplayer/protocol";
import { resampleAllSegments, splitIntoSegments } from "../../engine/normalizePath";
import type { RoomTransport } from "../../multiplayer/roomTransport";
import type { DrawingPath } from "../../types/Challenge";

type PlayTogetherRoomProps = {
  transport: RoomTransport;
  onExit: () => void;
  /**
   * Whether there is a game worth protecting from an accidental exit.
   *
   * Reported upward rather than decided in the screen, because only the room
   * sees the phase. True from the moment a game starts until the champion
   * screen: the lobby is nothing to lose, and a finished game is over.
   */
  onActiveChange?: (active: boolean) => void;
};

const DIFFICULTY_LABELS: Record<MultiplayerDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  mixed: "Mixed",
};

/**
 * Shrinks a finished drawing to the wire budget using the same segment-aware
 * resampler the share links use, so `breaks` survive and no phantom connector
 * line is ever introduced. The server rejects anything longer than
 * MAX_SUBMIT_POINTS, and a 30-second scribble easily runs to thousands.
 */
function toSubmittablePath(path: DrawingPath): DrawingPath {
  if (path.points.length <= MP_LIMITS.MAX_SUBMIT_POINTS) return path;
  const segments = splitIntoSegments(path.points, path.breaks).filter((s) => s.length > 1);
  if (segments.length === 0) return path;
  const { points, segmentStarts } = resampleAllSegments(segments, MP_LIMITS.MAX_SUBMIT_POINTS);
  return { points, canvasWidth: path.canvasWidth, canvasHeight: path.canvasHeight, breaks: segmentStarts };
}

export default function PlayTogetherRoom({ transport, onExit, onActiveChange }: PlayTogetherRoomProps) {
  const { snapshot, error, dismissError, send, clockOffsetMs, status } = useRoom(transport);
  const remainingMs = useDeadlineRemaining(snapshot?.phaseEndsAt ?? null, clockOffsetMs);

  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const [attempt, setAttempt] = useState<DrawingPath | null>(null);
  // Local echo of "I pressed DONE". The snapshot is the real authority, but
  // this flips the instant the button is pressed so the canvas locks without
  // waiting for a round trip.
  const [submitting, setSubmitting] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const [tutorial, setTutorial] = useState<"host" | "guest" | null>(null);
  const [coachArmed] = useState(() => shouldShowRoundCoach());
  const penColor = useMemo(() => getSelectedColor(), []);

  const phase = snapshot?.phase ?? "LOBBY";
  const you = snapshot?.you ?? null;
  const isHost = you?.isHost ?? false;
  const submitted = you?.submitted ?? false;
  const roundIndex = snapshot?.roundIndex ?? -1;

  // First-run tutorial, keyed on the role you actually hold. Host and guest
  // have separate flags, so being a guest once does not consume the
  // explanation you need the first time you host.
  useEffect(() => {
    if (!snapshot || phase !== "LOBBY") return;
    if (isHost && shouldShowHostTutorial()) setTutorial("host");
    else if (!isHost && shouldShowGuestTutorial()) setTutorial("guest");
  }, [snapshot, phase, isHost]);

  function dismissTutorial() {
    if (tutorial === "host") markHostTutorialShown();
    if (tutorial === "guest") markGuestTutorialShown();
    setTutorial(null);
  }

  /**
   * Hold the screen awake for as long as this room is on screen.
   *
   * Play Together is the one mode where a player legitimately watches without
   * touching anything for 20 seconds at a time, which is exactly when a phone
   * dims and locks. Released on unmount, so leaving the room - by any route,
   * including the hardware back button - always gives the lock back.
   */
  useEffect(() => clearSocialPointsOverride, []);

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

  // Reset per-round drawing state whenever a new round begins.
  useEffect(() => {
    setAttempt(null);
    setSubmitting(false);
    setRevealDone(false);
    canvasRef.current?.clear();
  }, [roundIndex]);

  // The coach marks cover round 1 only, and are retired the moment it ends.
  useEffect(() => {
    if (coachArmed && roundIndex === 1) markRoundCoachShown();
  }, [coachArmed, roundIndex]);

  // --- analytics --------------------------------------------------------
  // Emitted from snapshot transitions rather than from button handlers, so a
  // round that ended on the server clock counts exactly the same as one the
  // player finished by hand. Every payload is aggregate-only: never the room
  // code, a nickname, a seat, a token or any drawing data.
  const reportedRoundRef = useRef(-1);
  const reportedStartRef = useRef(false);
  const reportedFinishRef = useRef(false);
  const joinReportedRef = useRef(false);
  const playerCount = snapshot?.players.length ?? 0;

  useEffect(() => {
    if (!snapshot || joinReportedRef.current) return;
    joinReportedRef.current = true;
    // Only the arriving player reports, so this counts joins and not every
    // peer's view of them.
    if (!snapshot.you?.isHost) trackEvent("mp_player_joined", { playerCount: snapshot.players.length });
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;

    if (snapshot.phase === "LOBBY") {
      // A rematch returns to the lobby, so re-arm for the next game.
      reportedStartRef.current = false;
      reportedFinishRef.current = false;
      reportedRoundRef.current = -1;
      return;
    }

    if (!reportedStartRef.current && snapshot.roundIndex >= 0) {
      reportedStartRef.current = true;
      trackEvent("mp_game_started", {
        playerCount: snapshot.players.length,
        roundCount: snapshot.rounds,
        difficulty: snapshot.difficulty,
      });
    }

    if (snapshot.phase === "ROUND_RESULTS" || snapshot.phase === "FINAL_RESULTS") {
      if (reportedRoundRef.current !== snapshot.roundIndex && snapshot.roundIndex >= 0) {
        reportedRoundRef.current = snapshot.roundIndex;
        trackEvent("mp_round_completed", {
          roundIndex: snapshot.roundIndex,
          playerCount: snapshot.players.length,
          submitted: snapshot.you?.submitted ?? false,
        });
      }
    }

    if (snapshot.phase === "FINAL_RESULTS" && !reportedFinishRef.current) {
      reportedFinishRef.current = true;
      trackEvent("mp_game_finished", { playerCount: snapshot.players.length, roundCount: snapshot.rounds });
    }
  }, [snapshot]);

  // A drop is only worth reporting once per outage, and only with the phase it
  // interrupted - that is the whole diagnostic value.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (status === "open") {
      wasConnectedRef.current = true;
      return;
    }
    if (status === "reconnecting" && wasConnectedRef.current) {
      wasConnectedRef.current = false;
      trackEvent("mp_disconnect", { phase });
    }
  }, [status, phase]);

  // The countdown ending is the one cue a player acts on immediately, so it
  // gets a tick and a tap. Keyed on the round so it fires once per round and
  // not on every re-render inside DRAWING.
  const drawCueRef = useRef(-1);
  useEffect(() => {
    if (phase !== "DRAWING" || roundIndex < 0) return;
    if (drawCueRef.current === roundIndex) return;
    drawCueRef.current = roundIndex;
    playRoundStartSound();
    hapticRoundStart();
  }, [phase, roundIndex]);

  // ------------------------------------------------- Social Points award ----
  /**
   * Paid once per player, per finished match.
   *
   * Each client awards only ITSELF - there is no server ledger, and a client
   * cannot be trusted to hand out points to its peers anyway. The key comes from
   * the room's `gameSerial`, which the DO bumps once per Start, so every repeat
   * of the final snapshot, every reconnect and every remount lands on the same
   * key and pays nothing, while a rematch that is actually played out to the end
   * gets a new key and earns again.
   *
   * Reaching FINAL_RESULTS at all is what "completed" means: a room that is
   * abandoned, a player who only joins the lobby, a single round and a rematch
   * that nobody finishes never get here.
   */
  const [award, setAward] = useState<{ points: number; total: number; previousTotal: number } | null>(null);
  const awardedRef = useRef("");
  useEffect(() => {
    if (!snapshot || snapshot.phase !== "FINAL_RESULTS") return;
    const seatId = snapshot.you?.seatId;
    if (!seatId) return;
    const awardId = multiplayerAwardId(snapshot.roomCode, snapshot.gameSerial, seatId);
    if (awardedRef.current === awardId) return;
    awardedRef.current = awardId;
    const points = multiplayerAwards(snapshot.players.map((p) => ({ id: p.seatId, totalScore: p.totalScore }))).get(seatId) ?? 0;
    const result = awardSocialPoints(awardId, points);
    // Same guard as Pass & Play: `granted` is false for every repeat, so a
    // reconnect or a re-delivered final snapshot cannot double-count.
    if (result.granted && result.points > 0) {
      trackEvent("social_points_awarded", { source: "multiplayer", amount: result.points });
      const promotions = crossedRanks(result.total - result.points, result.total);
      if (promotions.length > 0) {
        trackEvent("social_rank_up", { source: "multiplayer", newRank: promotions[promotions.length - 1].name as SocialRankParam });
      }
    }
    // Hold the header badge at the old total until the card takes over.
    if (result.points > 0) setSocialPointsOverride(result.total - result.points);
    setAward({ points: result.points, total: result.total, previousTotal: result.total - result.points });
  }, [snapshot]);

  useEffect(() => {
    const live = phase !== "LOBBY" && phase !== "FINAL_RESULTS" && phase !== "ABANDONED";
    onActiveChange?.(live);
  }, [onActiveChange, phase]);

  const showCoach = coachArmed && roundIndex === 0;
  /** Whether there is anything on the canvas yet - gates the second coach mark and the DONE button. */
  const hasDrawn = (attempt?.points.length ?? 0) >= 2;

  const target = useMemo(() => {
    if (!snapshot?.shapeId) return undefined;
    return getShapeById(snapshot.shapeId)?.generate(CANVAS_SIZE);
  }, [snapshot?.shapeId]);

  /** `allowEmpty` is only ever set by the deadline handler; the DONE button requires an actual drawing. */
  function handleDone(allowEmpty = false) {
    if (!snapshot || submitting || submitted) return;
    const drawn = attempt && attempt.points.length >= 2;
    if (!drawn && !allowEmpty) return;
    setSubmitting(true);
    send({
      type: "submit",
      roundIndex: snapshot.roundIndex,
      path: drawn ? toWirePath(toSubmittablePath(attempt)) : null,
    });
  }

  // At 0s everyone submits, drawn or not.
  //
  // Submitting whatever is on the canvas saves the player who drew a good shape
  // and never tapped DONE. Submitting an EMPTY canvas matters for a different
  // reason: it marks them finished, so the round closes as soon as the last
  // person is done instead of the whole room waiting out the window for
  // somebody who never picked up the pen. Either way the server scores it.
  useEffect(() => {
    if (phase !== "DRAWING" || submitted || submitting) return;
    if (remainingMs === null || remainingMs > 0) return;
    /*
     * Re-read the deadline instead of trusting `remainingMs`, which lags one
     * render behind a phase change: the tick that ran it to 0 belonged to the
     * expiring SHOW_SHAPE deadline, and the render that applies the DRAWING
     * snapshot still closes over that stale 0.
     *
     * Without this, a client whose DRAWING snapshot arrives more than one
     * 200ms tick after the SHOW_SHAPE deadline auto-submits an empty canvas
     * the instant the drawing window opens - scoring 0 for the round with no
     * chance to draw. It has been invisible only because the snapshot normally
     * beats the next tick; a slow or congested link is all it takes. It was
     * found in Pass & Play, where the phase change IS the tick reaching 0 and
     * so it failed on the very first run.
     */
    const deadline = snapshot?.phaseEndsAt ?? null;
    if (deadline === null || Date.now() + clockOffsetMs < deadline) return;
    handleDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, phase, submitted, submitting]);

  if (!snapshot) {
    return (
      <div className="mp-stage">
        <p className="status-text" role="status">
          {status === "reconnecting" ? "Reconnecting…" : "Connecting to the room…"}
        </p>
        <Button variant="secondary" onClick={onExit}>
          Cancel
        </Button>
      </div>
    );
  }

  const players = snapshot.players;
  const submittedCount = players.filter((p) => p.submitted).length;
  const winner = snapshot.lastRound?.winnerSeatId
    ? players.find((p) => p.seatId === snapshot.lastRound!.winnerSeatId) ?? null
    : null;
  const champion = snapshot.championSeatId ? players.find((p) => p.seatId === snapshot.championSeatId) ?? null : null;

  const roundLabel = formatRoundLabel(roundIndex, snapshot.rounds);
  // The server keeps a disconnected host in the role for a grace period before
  // promoting someone else, so "host present but not connected" is a real and
  // temporary state the UI has to explain.
  const hostAway = players.some((p) => p.isHost && !p.connected);

  return (
    <div className="mp-room">
      {tutorial && <MultiplayerTutorialOverlay role={tutorial} onDismiss={dismissTutorial} />}

      {/*
        A dropped socket on a phone usually looks like silence rather than a
        close event, so the player has to be told the game is still there. The
        last snapshot stays on screen underneath: it is stale by definition,
        but a frozen board reads far better than an empty one, and the next
        snapshot after reconnecting replaces all of it at once.
      */}
      {status === "reconnecting" && (
        <div className="mp-reconnecting" role="status">
          <span className="mp-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Reconnecting — your place is saved
        </div>
      )}

      {error && (
        <div className="mp-error" role="alert">
          <span>{error.message}</span>
          <button type="button" className="mp-error-dismiss" onClick={dismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/*
        The host has dropped and is inside their grace period. Everyone sees
        this, because until it resolves nobody can advance the game - and
        without saying so, a results screen with no Next button just looks
        broken.
      */}
      {hostAway && (
        <p className="mp-host-away" role="status">
          Waiting for the host to reconnect…
        </p>
      )}

      {/* ---------------------------------------------------------- LOBBY -- */}
      {phase === "LOBBY" && (
        <div className="mp-lobby">
          <RoomCodeCard roomCode={snapshot.roomCode} />

          <section className="mp-panel" aria-labelledby="mp-players-heading">
            <h2 id="mp-players-heading" className="mp-panel-heading">
              Players <span className="mp-count">{players.length}/{MP_LIMITS.MAX_PLAYERS}</span>
            </h2>
            <ul className="mp-roster">
              {players.map((p) => (
                <li key={p.seatId} className="mp-roster-row">
                  <span className="mp-roster-avatar" aria-hidden="true">
                    {p.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="mp-roster-name">{p.nickname}</span>
                  {p.seatId === you?.seatId && <span className="mp-lb-tag">You</span>}
                  {p.isHost && <span className="mp-lb-tag mp-lb-tag-host">Host</span>}
                </li>
              ))}
            </ul>
            {players.length < MP_LIMITS.MIN_PLAYERS_TO_START && (
              <p className="mp-hint">Waiting for at least one more player to join…</p>
            )}
          </section>

          {isHost ? (
            <section className="mp-panel" aria-labelledby="mp-settings-heading">
              <h2 id="mp-settings-heading" className="mp-panel-heading">
                Game settings
              </h2>

              <fieldset className="mp-fieldset">
                <legend className="mp-legend">Rounds</legend>
                <div className="mp-chip-row">
                  {ROUND_COUNT_OPTIONS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={count === snapshot.rounds ? "mp-chip mp-chip-active" : "mp-chip"}
                      aria-pressed={count === snapshot.rounds}
                      onClick={() => send({ type: "configure", rounds: count, difficulty: snapshot.difficulty })}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mp-fieldset">
                <legend className="mp-legend">Difficulty</legend>
                <div className="mp-chip-row">
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={option === snapshot.difficulty ? "mp-chip mp-chip-active" : "mp-chip"}
                      aria-pressed={option === snapshot.difficulty}
                      onClick={() => send({ type: "configure", rounds: snapshot.rounds, difficulty: option })}
                    >
                      {DIFFICULTY_LABELS[option]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <Button
                className="mp-primary-action"
                onClick={() => send({ type: "start" })}
                disabled={players.length < MP_LIMITS.MIN_PLAYERS_TO_START}
              >
                Start Game
              </Button>
            </section>
          ) : (
            <section className="mp-panel mp-waiting-panel">
              <p className="mp-waiting-title">
                <span className="mp-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Waiting for the host
              </p>
              <p className="mp-hint">
                {snapshot.rounds} rounds · {DIFFICULTY_LABELS[snapshot.difficulty]}. The game starts when the host is ready.
              </p>
            </section>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ COUNTDOWN -- */}
      {phase === "COUNTDOWN" && (
        <div className="mp-stage mp-stage-countdown">
          <p className="mp-round-label">{roundLabel}</p>
          {/* No shape here by construction: the server withholds shapeId until SHOW_SHAPE. */}
          <p className="mp-countdown-number" aria-live="assertive">
            {remainingMs === null ? "" : Math.max(1, Math.ceil(remainingMs / 1000))}
          </p>
          <p className="mp-stage-caption">Get ready…</p>
        </div>
      )}

      {/* ----------------------------------------- SHOW_SHAPE and DRAWING -- */}
      {(phase === "SHOW_SHAPE" || phase === "DRAWING") && (
        <div className="mp-stage">
          <div className="mp-stage-header">
            <p className="mp-round-label">{roundLabel}</p>
            {phase === "DRAWING" && <RoundTimer remainingMs={remainingMs} totalMs={MP_TIMINGS.DRAWING_MS} />}
          </div>

          {phase === "SHOW_SHAPE" && (
            <>
              <p className="mp-stage-caption mp-stage-caption-strong">Memorise it — it disappears in {remainingMs === null ? 3 : Math.max(1, Math.ceil(remainingMs / 1000))}s</p>
              {showCoach && <RoundCoachMark text="Remember this shape!" />}
            </>
          )}

          {phase === "DRAWING" && !submitted && (
            <>
              <p className="mp-stage-caption">Draw it from memory</p>
              {/*
                One hint at a time, and always in the SAME slot. Swapping the
                two between a position above the canvas and one below it moved
                the canvas 62px mid-stroke, so the first stroke jumped away from
                the finger. Only the text changes now; nothing around the canvas
                mounts or unmounts while someone is drawing on it.
              */}
              {showCoach && (
                <RoundCoachMark
                  text={hasDrawn ? "Finished? Tap DONE — finishing early earns a speed bonus." : "Draw it from memory — the shape is gone now!"}
                />
              )}
            </>
          )}

          {/*
            One persistent canvas across both phases rather than two mounted in
            turn: the ghost is simply switched off, which makes "the shape is
            gone" a guaranteed consequence of the phase rather than a race
            between an unmount and a remount.
          */}
          <div className="canvas-wrapper mp-canvas-wrapper">
            <DrawingCanvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              // Locked during SHOW_SHAPE, and locked again the moment DONE is
              // pressed - a submitted drawing can never be edited.
              disabled={!canDrawNow(phase, submitted, submitting)}
              ghostPath={showsTargetShape(phase) ? target : undefined}
              showGhost={showsTargetShape(phase)}
              strokeColor={penColor}
              onChange={setAttempt}
              onComplete={setAttempt}
              ariaLabel={phase === "SHOW_SHAPE" ? "The shape to memorise" : "Draw the shape from memory"}
            />
          </div>

          {phase === "DRAWING" && !submitted && !submitting && (
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
            </>
          )}

          {(submitted || submitting) && phase === "DRAWING" && (
            <section className="mp-waiting-panel" aria-live="polite">
              <p className="mp-waiting-title">
                <span className="mp-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Waiting for other players
              </p>
              <p className="mp-hint">
                {submittedCount} of {players.length} finished
              </p>
              <ul className="mp-submit-status">
                {players.map((p) => (
                  <li key={p.seatId} className={p.submitted ? "mp-submit-done" : "mp-submit-pending"}>
                    <span aria-hidden="true">{p.submitted ? "✅" : "✏️"}</span>
                    {p.nickname}
                    <span className="sr-only">{p.submitted ? " finished" : " still drawing"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* -------------------------------------------------- ROUND_RESULTS -- */}
      {phase === "ROUND_RESULTS" && (
        <div className="mp-stage">
          <p className="mp-round-label">{roundLabel}</p>

          {!revealDone ? (
            <WinnerReveal
              nickname={winner?.nickname ?? null}
              score={winner?.roundScore ?? null}
              isYou={winner?.seatId === you?.seatId}
              variant="round"
              onDone={() => setRevealDone(true)}
            />
          ) : (
            <>
              <MultiplayerLeaderboard players={players} yourSeatId={you?.seatId ?? null} highlightSeatIds={winner ? [winner.seatId] : null} />

              {showCoach && <RoundCoachMark text="Scores add up across every round — there's plenty of time to catch up." />}

              {hostControlFor(phase, isHost) === "next" ? (
                <Button className="mp-primary-action" onClick={() => send({ type: "next" })}>
                  Next Round
                </Button>
              ) : (
                <p className="mp-waiting-title mp-waiting-inline">
                  <span className="mp-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Waiting for the host to start the next round
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------- FINAL_RESULTS -- */}
      {phase === "FINAL_RESULTS" && (
        <div className="mp-stage">
          {!revealDone ? (
            <WinnerReveal
              nickname={champion?.nickname ?? null}
              score={champion?.totalScore ?? null}
              isYou={champion?.seatId === you?.seatId}
              variant="champion"
              onDone={() => setRevealDone(true)}
            />
          ) : (
            <>
              <h2 className="mp-final-heading">
                <span aria-hidden="true">👑</span> {champion ? `${champion.nickname} is the CYDI Champion` : "Final scores"}
              </h2>
              <MultiplayerLeaderboard
                players={players}
                yourSeatId={you?.seatId ?? null}
                highlightSeatIds={champion ? [champion.seatId] : null}
                showRoundScore={false}
              />
              {/* Local-device progression only: never sent to the room, never shown for a peer. */}
              {award && (
                <>
                  <SocialPointsAward points={award.points} total={award.total} />
                  <SocialProgressCard previousTotal={award.previousTotal} total={award.total} pointsAwarded={award.points} />
                </>
              )}
              <div className="button-row mp-final-actions">
                <Button variant="secondary" onClick={onExit}>
                  Exit
                </Button>
                {hostControlFor(phase, isHost) === "rematch" ? (
                  <Button
                    onClick={() => {
                      trackEvent("mp_rematch", { playerCount });
                      setAward(null);
                      clearSocialPointsOverride();
                      send({ type: "rematch" });
                    }}
                  >
                    Play Again
                  </Button>
                ) : (
                  <span className="mp-hint mp-hint-inline">Only the host can start a rematch</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {phase === "ABANDONED" && (
        <div className="mp-stage">
          <p className="status-text">This room has closed.</p>
          <Button onClick={onExit}>Back</Button>
        </div>
      )}
    </div>
  );
}
