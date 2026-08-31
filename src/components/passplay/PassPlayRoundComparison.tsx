/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import ShapeOverlayCanvas from "../ShapeOverlayCanvas";
import { CANVAS_SIZE, type PenColorId } from "../../app/constants";
import type { PassPlayPlayer } from "../../passplay/passPlayGame";
import type { DrawingPath } from "../../types/Challenge";

type PassPlayRoundComparisonProps = {
  target: DrawingPath;
  /** In turn order, so the drawings read in the order they were made. */
  players: readonly PassPlayPlayer[];
  /** Ids of the round winner(s). More than one is a tie, and both are marked the same. */
  winnerIds: readonly string[];
  penColor: PenColorId;
};

/** An empty canvas of the right shape, so the reference panel can render the guide with nothing drawn over it. */
const NOTHING: DrawingPath = { points: [], canvasWidth: CANVAS_SIZE, canvasHeight: CANVAS_SIZE };

/**
 * The "look at yours vs mine" moment: the shape they were given, then what each
 * of them actually drew, with the numbers that decided it.
 *
 * Every attempt is drawn over the reference guide rather than bare - seeing the
 * shape you missed underneath your own line is the whole reason this screen
 * exists, and it is what makes a score of 38 legible without explaining
 * anything. The bare reference sits above them so there is something to compare
 * against before you start reading lines.
 *
 * This is deliberately NOT the single-player result screen: no star rating, no
 * share, no coins, no guide toggle. Three numbers per player, a winner mark, and
 * the drawings big enough to actually look at.
 *
 * The verdict is stated BEFORE the evidence. Comparing two cards to work out who
 * won is work the screen can do for the player, so the banner says it outright
 * and the cards below are then just the reason.
 */
export default function PassPlayRoundComparison({ target, players, winnerIds, penColor }: PassPlayRoundComparisonProps) {
  /*
   * The verdict, derived entirely from the props this component already gets -
   * no new state, no new prop, nothing asked of the game logic.
   *
   * SCOPE. This component compares ONE ROUND (`round.score` is the round's
   * score, and the section is labelled "Round drawings"), so the margin is the
   * gap between round scores. A cumulative `totalScore` gap would be a
   * different claim about a different scope and is deliberately not shown here.
   *
   * TIES are real - `winnerIds` is an array precisely because two players can
   * draw level - so a tie says so and shows no margin, because there isn't one.
   */
  const winners = players.filter((player) => winnerIds.includes(player.id));
  const isTie = winners.length > 1;
  const roundScore = (id: string) => players.find((p) => p.id === id)?.round?.score ?? 0;
  const bestWinnerScore = winners.length > 0 ? Math.max(...winners.map((w) => roundScore(w.id))) : 0;
  const runnersUp = players.filter((player) => !winnerIds.includes(player.id));
  const bestRunnerUpScore = runnersUp.length > 0 ? Math.max(...runnersUp.map((p) => p.round?.score ?? 0)) : null;
  const margin = bestRunnerUpScore === null ? null : bestWinnerScore - bestRunnerUpScore;

  return (
    <section className="pp-compare" aria-label="Round drawings">
      {winners.length > 0 && (
        <p className="pp-verdict">
          <span className="pp-verdict-mark" aria-hidden="true">
            🏆
          </span>
          <span className="pp-verdict-text">
            <span className="pp-verdict-label">{isTie ? "Tied" : "Winner"}</span>
            <strong className="pp-verdict-name">{winners.map((w) => w.name).join(" & ")}</strong>
          </span>
          {/* Only when there is a real margin to state. */}
          {!isTie && margin !== null && margin > 0 && (
            <span className="pp-verdict-margin">
              <span className="pp-verdict-margin-label">By</span>
              <strong className="pp-verdict-margin-value">{margin}</strong>
            </span>
          )}
        </p>
      )}

      <div className="pp-compare-target">
        <p className="pp-compare-heading">The shape</p>
        <ShapeOverlayCanvas
          target={target}
          attempt={NOTHING}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          ariaLabel="The shape both players were asked to draw"
        />
      </div>

      {/*
        One column per player on anything wide enough, stacked below that. Two
        160px canvases on a 320px phone would be too small to judge a drawing
        by, which would defeat the point - so the CSS stacks them rather than
        shrinking them.
      */}
      <ul className="pp-compare-grid">
        {players.map((player) => {
          const won = winnerIds.includes(player.id);
          const round = player.round;
          return (
            <li key={player.id} className={won ? "pp-compare-card pp-compare-card-win" : "pp-compare-card"}>
              <p className="pp-compare-name">
                {won && (
                  <span className="pp-compare-crown" aria-hidden="true">
                    🏆
                  </span>
                )}
                {player.name}
                {won && <span className="sr-only"> won this round</span>}
              </p>

              {round?.path ? (
                <ShapeOverlayCanvas
                  target={target}
                  attempt={round.path}
                  attemptColor={penColor}
                  width={CANVAS_SIZE}
                  height={CANVAS_SIZE}
                  ariaLabel={`${player.name}'s drawing over the reference shape`}
                />
              ) : (
                // A player who never picked up the pen still gets a panel, so
                // the two sides stay symmetrical and the zero is explained.
                <div className="pp-compare-empty" role="img" aria-label={`${player.name} did not draw anything`}>
                  <span aria-hidden="true">⏳</span>
                  <span>Ran out of time</span>
                </div>
              )}

              <p className="pp-compare-score">+{round?.score ?? 0}</p>
              <p className="pp-compare-detail">
                <span>Accuracy {round?.accuracy ?? 0}%</span>
                <span>Speed {round?.speed ?? 0}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
