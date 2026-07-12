import { useState } from "react";
import ShapeOverlayCanvas from "./ShapeOverlayCanvas";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, penColorCssBackground, type PenColorId } from "../app/constants";
import type { DrawingPath } from "../types/Challenge";
import { playToggleSound } from "../engine/soundEngine";

type ResultComparisonProps = {
  target: DrawingPath;
  attempt: DrawingPath;
  attemptColor?: PenColorId;
  targetLabel?: string;
  attemptLabel?: string;
  /** Accessible description of the comparison while the guide is shown. */
  ariaLabel?: string;
};

/** Result-screen comparison of the target guide and the player's attempt, with a
 * toggle to show/hide the guide. State lives here (not in the screen) so the
 * guide is visible again by default every time a result screen is re-entered. */
export default function ResultComparison({
  target,
  attempt,
  attemptColor = DEFAULT_PEN_COLOR,
  targetLabel = "Target shape",
  attemptLabel = "Your drawing",
  ariaLabel,
}: ResultComparisonProps) {
  const [showGuide, setShowGuide] = useState(true);

  function toggleGuide() {
    setShowGuide((visible) => !visible);
    playToggleSound();
  }

  return (
    <>
      <div className="canvas-wrapper">
        <ShapeOverlayCanvas
          target={showGuide ? target : undefined}
          attempt={attempt}
          attemptColor={attemptColor}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          ariaLabel={showGuide ? ariaLabel : attemptLabel}
        />
      </div>
      <p className="overlay-legend">
        {showGuide && (
          <>
            <span className="overlay-legend-swatch overlay-legend-target" /> {targetLabel}
          </>
        )}
        <span
          className="overlay-legend-swatch"
          style={{
            background: penColorCssBackground(attemptColor),
            marginLeft: showGuide ? "var(--space-3)" : undefined,
          }}
        />{" "}
        {attemptLabel}
      </p>
      <div className="guide-toggle-row">
        <span className="guide-toggle-label">Guide</span>
        <button
          type="button"
          className={showGuide ? "guide-toggle is-on" : "guide-toggle"}
          onClick={toggleGuide}
          aria-pressed={showGuide}
          aria-label={showGuide ? "Hide guide" : "Show guide"}
        >
          <span className="guide-toggle-knob" aria-hidden="true">
            {showGuide ? "👁️" : "🙈"}
          </span>
        </button>
      </div>
    </>
  );
}
