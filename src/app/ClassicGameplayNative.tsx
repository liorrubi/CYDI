/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The approved "Classic - Show and Draw" layout, on Android.
 *
 * WHY THIS COMPONENT EXISTS. The active round used the full AppHeader (181px
 * plus its nav row), a bare status line, the canvas, then a loose row of two
 * circles and three same-weight buttons in which Show Guide, Undo and Done all
 * looked equally like the way forward. The design's whole argument is that
 * chrome should be measured in what it costs the canvas, and that the tools are
 * one object rather than four - neither of which the old order can express.
 *
 * IT IS PRESENTATION ONLY. No state, no effects, no timers, no scoring, no
 * phase transitions. It receives the phase, the strings the screen already
 * computes, the real control nodes and the real handlers, and arranges them.
 * The screen keeps every decision about what a phase is and when it changes.
 *
 * THE CANVAS IS NOT TOUCHED. `canvas` is passed straight through and rendered
 * as-is. Nothing here sets its width, height or aspect ratio.
 *
 * ONE SURFACE. Show and Draw render the same canvas node in the same place at
 * the same size; only the ghost and the tools change. A previous pass gave Show
 * its own dark stage, and on the device that made the two phases read as two
 * screens - which is the opposite of what the round is. The instruction now sits
 * in a fixed row above the surface in BOTH phases, at one size, so the surface
 * never moves between them either.
 *
 * ANDROID ONLY. ShapeChallengeScreen renders it behind
 * `Capacitor.isNativePlatform()`; the web keeps the existing markup.
 *
 * WHAT THE DESIGN ASKS FOR THAT CYDI DOES NOT HAVE, and is therefore absent:
 *   - an eraser. There is no eraser anywhere in the codebase.
 *   - "It disappears when the drawing starts." No such line exists; the real
 *     instruction is the only one shown.
 *   - a visible countdown in every round. `previewSecondsLeft` is real, but the
 *     product only shows it in the first coached round, and that rule is the
 *     screen's, not this component's - it just prints the string it is handed.
 */
import type { ReactNode } from "react";
import CoinIndicator from "../components/CoinIndicator";
import { GuideIcon, UndoIcon } from "./appIcons";
import "../styles/appShell.css";

/** The three real phases of a round. `analyzing` is not a design phase; it keeps Draw lit. */
export type ClassicPhase = "preview" | "drawing" | "analyzing";

type ClassicGameplayNativeProps = {
  phase: ClassicPhase;
  /** The shape's name, for the header. */
  shapeName: string;
  /** "Best: 96% · Pass score: 70+" - built by the screen, printed here. */
  subtitle: string;
  onBack: () => void;
  /**
   * Passed to the real CoinIndicator, exactly as AppHeader does it, so the coin
   * pill keeps the shop shortcut it already has on this screen.
   */
  onNavigateToShop?: () => void;

  /**
   * The live DrawingCanvas - the ONE surface this screen has. It is mounted for
   * the whole round, never remounted, and it draws the target itself during
   * preview, so Show and Draw are the same node rather than two that match.
   */
  canvas: ReactNode;

  /** The real instruction string for this phase. */
  instruction: string;
  /** Set when the screen is showing its coached-round copy, which is styled as a hint. */
  coached?: boolean;

  /** <PenColorMenu/>, untouched. */
  inkControl?: ReactNode;
  /** <PenSkinMenu/>, untouched. */
  penControl?: ReactNode;
  onUndo?: () => void;
  undoDisabled?: boolean;
  guideEnabled?: boolean;
  onToggleGuide?: () => void;
  onDone?: () => void;
  /** The coach pulse the screen already puts on Done. */
  donePulse?: boolean;

  /** Tutorial overlays, which position themselves. */
  overlays?: ReactNode;
};

export default function ClassicGameplayNative({
  phase,
  shapeName,
  subtitle,
  onBack,
  onNavigateToShop,
  canvas,
  instruction,
  coached,
  inkControl,
  penControl,
  onUndo,
  undoDisabled,
  guideEnabled,
  onToggleGuide,
  onDone,
  donePulse,
  overlays,
}: ClassicGameplayNativeProps) {
  const drawing = phase === "drawing";
  /*
   * Which pill is lit. `analyzing` happens after the pen is down and before the
   * result, so Draw stays lit rather than inventing a third pill for a state the
   * design never covered.
   */
  const showLit = phase === "preview";

  return (
    <div className={`screen app-play app-play-${phase}`}>
      {/* 1 · Compact header. AppHeader is NOT modified and NOT used here: it
          carries the app-level nav row - chest, crown, achievements, share,
          settings - which is a dashboard, and mid-round every row of it is
          height taken from the canvas. Same tokens, three fewer rows. Back and
          the coin pill keep the handlers they already had. */}
      <header className="app-play-head">
        <button type="button" className="app-play-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div className="app-play-title">
          <strong className="app-play-shape">{shapeName}</strong>
          <span className="app-play-sub">{subtitle}</span>
        </div>
        <span className="app-play-coins">
          <CoinIndicator onClick={onNavigateToShop} />
        </span>
      </header>

      {/* 2 · The instruction. The primary line on this screen, in the same place
          at the same size in every phase - "Study the shape" and "Now draw it"
          are the same kind of thing and must not look like different kinds.

          One line, fixed height, deliberately: the coached round swaps in longer
          strings, and a row that could wrap would move the surface between Show
          and Draw - the exact discontinuity this pass exists to remove. */}
      <p className={coached ? "app-play-instruction coach-hint" : "app-play-instruction"} role="status">
        {instruction}
      </p>

      {/* 3 · The phase, as a secondary indicator - it says where you are, the
          line above says what to do. */}
      <div className="app-play-phase">
        <span className={showLit ? "app-play-pill app-play-pill-on" : "app-play-pill"}>
          {showLit && <span className="app-play-pill-dot" aria-hidden="true" />}
          Show
        </span>
        <span className="app-play-pill-rule" aria-hidden="true" />
        <span className={showLit ? "app-play-pill" : "app-play-pill app-play-pill-on"}>
          {!showLit && <span className="app-play-pill-dot" aria-hidden="true" />}
          Draw
        </span>
      </div>

      {/* 4 · The surface. One panel, one canvas, unchanged between the phases -
          the shape is shown here and then drawn here. */}
      <div className="app-play-stage">{canvas}</div>

      {drawing && (
        <>
          {/* 5 · One tray, not four buttons. Ink, Pen and Undo are the drawing
              group; a hairline separates Guide, which is a toggle rather than an
              action and so carries its state as a word, not just a colour. The
              two menus are the real components - their triggers, their
              dropdowns, their behaviour, unchanged. */}
          <div className="app-play-tray">
            {inkControl && (
              <span className="app-play-tool">
                {inkControl}
                <span className="app-play-tool-label">Ink</span>
              </span>
            )}
            {penControl && (
              <span className="app-play-tool">
                {penControl}
                <span className="app-play-tool-label">Pen</span>
              </span>
            )}
            <button type="button" className="app-play-tool app-play-tool-btn" onClick={onUndo} disabled={undoDisabled}>
              <UndoIcon />
              <span className="app-play-tool-label">Undo</span>
            </button>
            <span className="app-play-tray-rule" aria-hidden="true" />
            <button
              type="button"
              className={
                guideEnabled ? "app-play-tool app-play-tool-btn app-play-tool-on" : "app-play-tool app-play-tool-btn"
              }
              onClick={onToggleGuide}
              aria-pressed={guideEnabled}
            >
              <GuideIcon />
              {/* The state is a word as well as a fill, so the toggle is
                  readable in greyscale. */}
              <span className="app-play-tool-label">Guide · {guideEnabled ? "on" : "off"}</span>
            </button>
          </div>

          {/* 6 · Done: the only filled element on the screen, and the only
              full-width one. Nothing about the handler changes. */}
          <button
            type="button"
            className={donePulse ? "app-play-done coach-pulse" : "app-play-done"}
            onClick={onDone}
          >
            Done
          </button>
        </>
      )}

      {overlays}
    </div>
  );
}
