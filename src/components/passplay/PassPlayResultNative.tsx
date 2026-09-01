/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The approved Version B layout for the 2 Players round result, on Android.
 *
 * WHY THIS COMPONENT EXISTS. The previous screen read as: header, status badge,
 * round label, verdict, a ~365px reference panel, the two drawings, a
 * leaderboard repeating the two drawings' numbers, a tip, and only then the
 * button. Measured on the device that is long, duplicated, and the evidence
 * that justifies the verdict sits below the fold. Version B is a different
 * screen - verdict, evidence, total, next - so it gets its own presentation
 * rather than another layer of CSS over the old order.
 *
 * IT IS PRESENTATION ONLY. No state, no effects, no scoring, no turn order, no
 * pass-play state machine. Every number here is read from the `PassPlayPlayer`
 * objects the game already produced, and the one action is a handler the game
 * decided on. Nothing is recomputed and nothing is stored.
 *
 * ANDROID ONLY. PassPlayGame renders it behind `Capacitor.isNativePlatform()`;
 * the web keeps PassPlayRoundComparison + MultiplayerLeaderboard exactly as they
 * are.
 *
 * NOTHING FROM THE MOCKUP IS COPIED. Version B's frame shows "92%" / "67%",
 * star ratings, "Match · best of 5", a "2 — 1" wins tally and a five-segment
 * pip row. CYDI has none of that: a round score is a point total (`+38`), not a
 * percentage; there is no wins tally and no best-of, only a cumulative
 * `totalScore`; and this screen has never shown stars. So the score is the real
 * `+round.score` with no percent sign, the only match-level number is the real
 * cumulative total, and the accuracy/speed line reuses the wording the
 * leaderboard already uses.
 *
 * ROUND vs TOTAL is kept explicit, because mixing them would be a lie about
 * what the player is looking at:
 *   - the big number on each evidence card is the ROUND score
 *   - the strip below is labelled TOTAL and carries `totalScore`
 *   - the verdict's margin is a ROUND-score gap, never a cumulative one
 */
import type { ReactNode } from "react";
import ShapeOverlayCanvas from "../ShapeOverlayCanvas";
import { CANVAS_SIZE, type PenColorId } from "../../app/constants";
import type { PassPlayPlayer } from "../../passplay/passPlayGame";
import type { DrawingPath } from "../../types/Challenge";
import "../../styles/appShell.css";

/** An empty path, so the reference tile can draw the guide with nothing over it. */
const NOTHING: DrawingPath = { points: [], canvasWidth: CANVAS_SIZE, canvasHeight: CANVAS_SIZE };

type PassPlayResultNativeProps = {
  /** The game's own "Round 3 of 5" string - not rebuilt here. */
  roundLabel: string;
  /** The shape both players were given, for the reference tile. */
  target: DrawingPath;
  /** In turn order, so the two drawings read the way the round was played. */
  players: readonly PassPlayPlayer[];
  /** Sorted by cumulative total - the game's own `standings()` output. */
  standings: readonly PassPlayPlayer[];
  /** Round winner ids. More than one is a real tie and both are marked the same. */
  winnerIds: readonly string[];
  penColor: PenColorId;
  /** "Next Round" or "SEE FINAL RESULTS" - the game decides which, and what it does. */
  primaryLabel: string;
  onPrimary: () => void;
  /** The first-round coach mark, or null. Rendered after the actions. */
  tip?: ReactNode;
};

export default function PassPlayResultNative({
  roundLabel,
  target,
  players,
  standings,
  winnerIds,
  penColor,
  primaryLabel,
  onPrimary,
  tip,
}: PassPlayResultNativeProps) {
  /*
   * The verdict, derived from the props alone - the same derivation the web
   * comparison already does, moved rather than reinvented.
   *
   * The margin is the gap between ROUND scores, because this screen is one
   * round. A cumulative gap would be a different claim about a different scope.
   * A tie shows no margin, because there isn't one.
   */
  const winners = players.filter((player) => winnerIds.includes(player.id));
  const isTie = winners.length > 1;
  const roundScore = (player: PassPlayPlayer) => player.round?.score ?? 0;
  const bestWinnerScore = winners.length > 0 ? Math.max(...winners.map(roundScore)) : 0;
  const runnersUp = players.filter((player) => !winnerIds.includes(player.id));
  const bestRunnerUpScore = runnersUp.length > 0 ? Math.max(...runnersUp.map(roundScore)) : null;
  const margin = bestRunnerUpScore === null ? null : bestWinnerScore - bestRunnerUpScore;
  const showMargin = !isTie && margin !== null && margin > 0;

  return (
    <div className="pp-nres">
      {/* 1 · Context. The chrome above is trimmed to Back + "2 Players" by
          appShell.css, so this line carries the rest of it. */}
      <p className="pp-nres-round">{roundLabel}</p>

      {/* 2 · Verdict first. Reading two cards to work out who won is work the
          screen can do for the player. */}
      {winners.length > 0 && (
        <p className={isTie ? "pp-nres-verdict pp-nres-verdict-tie" : "pp-nres-verdict"}>
          <span className="pp-nres-verdict-mark" aria-hidden="true">
            {isTie ? "🤝" : "🏆"}
          </span>
          <span className="pp-nres-verdict-text">
            <span className="pp-nres-verdict-label">{isTie ? "Tied" : "Winner"}</span>
            <strong className="pp-nres-verdict-name">{winners.map((w) => w.name).join(" & ")}</strong>
          </span>
          {showMargin && (
            <span className="pp-nres-verdict-margin">
              <span className="pp-nres-verdict-margin-label">By</span>
              <strong className="pp-nres-verdict-margin-value">
                {margin} {margin === 1 ? "point" : "points"}
              </strong>
            </span>
          )}
        </p>
      )}

      {/* 3 · The evidence, immediately after the verdict: side by side, so the
          screen is a comparison rather than two results in sequence. */}
      <ul className="pp-nres-evidence">
        {players.map((player) => {
          const won = winnerIds.includes(player.id);
          const round = player.round;
          return (
            <li key={player.id} className={won ? "pp-nres-card pp-nres-card-win" : "pp-nres-card"}>
              {/* The winner is marked four ways - glyph, label, border weight and
                  score weight - so it survives greyscale. */}
              <p className="pp-nres-card-head">
                {won && (
                  <span className="pp-nres-card-mark" aria-hidden="true">
                    {isTie ? "🤝" : "🏆"}
                  </span>
                )}
                <span className="pp-nres-card-name">{player.name}</span>
                {won && <span className="sr-only"> {isTie ? "tied this round" : "won this round"}</span>}
              </p>

              <div className="pp-nres-card-stage">
                {round?.path ? (
                  <ShapeOverlayCanvas
                    target={target}
                    attempt={round.path}
                    attemptColor={penColor}
                    width={CANVAS_SIZE}
                    height={CANVAS_SIZE}
                    variant="dark"
                    ariaLabel={`${player.name}'s drawing over the reference shape`}
                  />
                ) : (
                  // A player who never picked up the pen still gets a panel, so
                  // the two sides stay symmetrical and the zero is explained.
                  <div
                    className="pp-nres-card-empty"
                    role="img"
                    aria-label={`${player.name} did not draw anything`}
                  >
                    <span aria-hidden="true">⏳</span>
                    <span>Ran out of time</span>
                  </div>
                )}
              </div>

              {/* ROUND score. No percent sign - a round score is points. */}
              <strong className="pp-nres-card-score">+{round?.score ?? 0}</strong>
              {/* The leaderboard's own wording, so the breakdown reads the same
                  everywhere it appears. */}
              <span className="pp-nres-card-detail">
                {round?.accuracy ?? 0}% acc · {round?.speed ?? 0} spd
              </span>
            </li>
          );
        })}
      </ul>

      {/* 4 · The shape, as a compact reference. Each attempt above is already
          drawn over the dashed guide, so this is context, not the hero it used
          to be - it was a 320px panel holding a 132px drawing. */}
      <div className="pp-nres-reference">
        <div className="pp-nres-reference-tile">
          <ShapeOverlayCanvas
            target={target}
            attempt={NOTHING}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            variant="dark"
            ariaLabel="The shape both players were asked to draw"
          />
        </div>
        <span className="pp-nres-reference-label">The shape</span>
      </div>

      {/* 5 · Match context, compact. The full leaderboard repeated the round
          score and the breakdown that the two cards above already show; the
          cumulative total was the only thing it added, so that is all this is. */}
      <p className="pp-nres-total">
        <span className="pp-nres-total-label">Total</span>
        {standings.map((player) => (
          <span className="pp-nres-total-entry" key={player.id}>
            <span className="pp-nres-total-name">{player.name}</span>
            <strong className="pp-nres-total-value">{player.totalScore}</strong>
          </span>
        ))}
      </p>

      {/* 6 · The next action. */}
      <div className="pp-nres-actions">
        <button type="button" className="pp-nres-primary" onClick={onPrimary}>
          {primaryLabel}
        </button>
      </div>

      {/* 7 · The coach mark, after the actions - it is advice about the match,
          and it must not push the button it is explaining below the fold. */}
      {tip}
    </div>
  );
}
