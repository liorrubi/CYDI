import { useState } from "react";
import ShapeOverlayCanvas, { overlayInkOverride, overlayTargetInk, type OverlayVariant } from "./ShapeOverlayCanvas";
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
  /** Forwarded to the canvas. Defaults to the light stage, unchanged. */
  variant?: OverlayVariant;
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
  variant = "light",
}: ResultComparisonProps) {
  const [showGuide, setShowGuide] = useState(true);

  /*
   * The legend has to state what the canvas actually drew. On the dark stage the
   * default black pen is remapped for legibility (see overlayInkOverride), so
   * the swatch reads from the SAME helper rather than from the stored pen
   * colour - otherwise the legend would promise a colour that is not on screen.
   */
  const inkOverride = overlayInkOverride(variant, attemptColor);
  const attemptSwatch = inkOverride ?? penColorCssBackground(attemptColor);

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
          variant={variant}
        />
      </div>
      <p className="overlay-legend">
        {showGuide && (
          <>
            <span
              className="overlay-legend-swatch overlay-legend-target"
              style={variant === "dark" ? { background: overlayTargetInk(variant) } : undefined}
            />{" "}
            {targetLabel}
          </>
        )}
        <span
          className="overlay-legend-swatch"
          style={{
            background: attemptSwatch,
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
