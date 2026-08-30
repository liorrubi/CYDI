/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The artwork on 3a's three mode cards.
 *
 * Each mode gets its OWN signature, because the card has to say what the mode
 * is before the label does - "one trace, two traces, a room full of traces" was
 * the whole point of describing the modes by their mechanic:
 *
 *   Classic     one drawing, one result
 *   2 Players   two DIFFERENT attempts at the same target, side by side, one winner
 *   Multiplayer one shared target, and RANKED ROOM RESULTS - never several
 *               players' strokes stacked on one canvas, because that is not how
 *               Multiplayer is presented: everyone draws on their own device.
 *
 * A single shared trace preview cannot carry that: three variations of the same
 * picture read as three variations of the same mode. So this is a dedicated
 * web-only component rather than another ShapePreviewIcon wrapper - the icon is
 * still what draws the shapes inside it, via TraceStack.
 *
 * THE DRAWINGS AND THEIR SCORES ARE CONSISTENT. Every attempt shown here is a
 * real, distinct point set from illustrativeAttempts.ts, and every percentage
 * is what the game's own scorer returns for that exact drawing - so the picture
 * and the number always agree. They are still illustrative: invented hands at
 * an invented moment, not anyone's stored result, and nothing is read from or
 * written to any store. The names below are the only fabricated content, and
 * the whole block is aria-hidden - the card's real text sits underneath it.
 */
import TraceStack from "./TraceStack";
import SiteShape from "./SiteShape";
import { asDrawnShape, illustrativeRoom, illustrativeRound } from "./illustrativeAttempts";
import type { ShapeDefinition } from "../content/contentRepository";
import type { SiteMode } from "../content/siteContent";

/**
 * Invented names for the room example, in finishing order - the scores beside
 * them are computed, so `winner` is simply whoever the scorer put first.
 */
const ROOM_NAMES = [
  { name: "Noa", swatch: "#a794e8", winner: true, you: false },
  { name: "You", swatch: "#5b5bf7", winner: false, you: true },
  { name: "Ilan", swatch: "#7fa8d9", winner: false, you: false },
  { name: "Maya", swatch: "#7cc9a0", winner: false, you: false },
];

/**
 * Both 2 Players attempts at one target, side by side, with the higher one
 * marked. Shared by the mode card and the mode-presentation panel so the two
 * places can never drift apart or disagree about who won.
 */
export function TwoPlayerAttempts({ shape }: { shape: ShapeDefinition }) {
  const round = illustrativeRound(shape);
  const players = [
    { label: "P1", attempt: round.steady, tone: "site-tracestack-p1" },
    { label: "P2", attempt: round.loose, tone: "site-tracestack-p2" },
  ];
  // Derived, never assumed: whoever the scorer actually rated higher wins.
  const best = Math.max(...players.map((p) => p.attempt.score));

  return (
    <>
      {players.map((player) => {
        const isWinner = player.attempt.score === best;
        return (
          <span
            key={player.label}
            className={isWinner ? "site-modeart-attempt site-modeart-attempt-win" : "site-modeart-attempt"}
          >
            <TraceStack
              shape={shape}
              attempt={asDrawnShape(shape, player.attempt.path, player.label)}
              className={player.tone}
            />
            <span className="site-modeart-attempt-foot">
              <span className="site-modeart-label">{player.label}</span>
              <strong className="site-modeart-score site-modeart-score-sm">{player.attempt.score}%</strong>
              {isWinner && <span className="site-modeart-win">Winner</span>}
            </span>
          </span>
        );
      })}
    </>
  );
}

type ModePreviewProps = {
  mode: SiteMode["id"];
  /** The real catalog shape every thumbnail draws. */
  shape: ShapeDefinition;
};

export default function ModePreview({ mode, shape }: ModePreviewProps) {
  const round = illustrativeRound(shape);

  if (mode === "classic") {
    return (
      <span className="site-modeart site-modeart-classic" aria-hidden="true">
        <TraceStack
          shape={shape}
          attempt={asDrawnShape(shape, round.steady.path, "classic")}
          className="site-tracestack-classic"
        />
        <span className="site-modeart-result">
          <span className="site-modeart-label">Your drawing</span>
          <strong className="site-modeart-score">{round.steady.score}%</strong>
        </span>
      </span>
    );
  }

  if (mode === "passPlay") {
    return (
      <span className="site-modeart site-modeart-two" aria-hidden="true">
        <TwoPlayerAttempts shape={shape} />
      </span>
    );
  }

  // The room's scores are real - each is what the scorer returns for one of
  // several distinct drawings - but the drawings themselves are never stacked
  // on one canvas here. What a room actually produces is a ranking.
  const room = illustrativeRoom(shape, ROOM_NAMES.length);
  const rows = room.map((entry, i) => ({ ...ROOM_NAMES[i], ...entry, rank: i + 1 }));

  return (
    <span className="site-modeart site-modeart-room" aria-hidden="true">
      <span className="site-modeart-rows">
        {rows.map((entry) => (
          <span
            key={entry.name}
            className={[
              "site-modeart-row",
              entry.winner ? "site-modeart-row-win" : null,
              entry.you ? "site-modeart-row-you" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="site-modeart-rank">{entry.rank}</span>
            <span className="site-modeart-swatch" style={{ background: entry.swatch }} />
            <span className="site-modeart-name">{entry.name}</span>
            {entry.winner && <span className="site-modeart-win">Room winner</span>}
            <strong className="site-modeart-score site-modeart-score-sm">{entry.score}%</strong>
          </span>
        ))}
      </span>
      {/* Secondary: the ONE shape the room was given - the target alone, with no
          drawing on it, so nothing suggests a shared canvas. */}
      <span className="site-modeart-roomart">
        <SiteShape shape={shape} size={120} strokeWidth={3} variant="site-modeart-targetshape" />
        <span className="site-modeart-roomart-label">
          Everyone
          <br />
          drew this
        </span>
      </span>
    </span>
  );
}

/**
 * The room's ranked results on their own, for surfaces with more space than a
 * card. Same data as the card, so the two can never disagree.
 */
export function RoomResults({ shape }: { shape: ShapeDefinition }) {
  const room = illustrativeRoom(shape, ROOM_NAMES.length);
  return (
    <span className="site-modeart-rows site-roomresults">
      {room.map((entry, i) => {
        const who = ROOM_NAMES[i];
        return (
          <span
            key={who.name}
            className={[
              "site-modeart-row",
              who.winner ? "site-modeart-row-win" : null,
              who.you ? "site-modeart-row-you" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="site-modeart-rank">{i + 1}</span>
            <span className="site-modeart-swatch" style={{ background: who.swatch }} />
            <span className="site-modeart-name">{who.name}</span>
            {who.winner && <span className="site-modeart-win">Room winner</span>}
            <strong className="site-modeart-score site-modeart-score-sm">{entry.score}%</strong>
          </span>
        );
      })}
    </span>
  );
}
