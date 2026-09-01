/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The approved Version B layout for Classic's result screen, on Android.
 *
 * WHY THIS COMPONENT EXISTS. The result screen's sections were laid out in an
 * order the design does not use - the drawing comparison came sixth, below the
 * continue buttons - and two earlier attempts to reach the design with scoped
 * CSS and `order` both failed the device check. Version B is a different
 * screen, not a re-skin, so it gets its own presentation.
 *
 * IT IS PRESENTATION ONLY. There is no state here, no effect, no scoring, no
 * storage and no navigation of its own. Every value and every handler is a prop
 * owned by ShapeChallengeScreen, which still decides what a round is worth,
 * what the message says, whether it was a personal best and what each button
 * does. The pieces that already own their own behaviour - the comparison with
 * its guide toggle, the reward offer, the tutorial overlay - are passed in as
 * nodes rather than rebuilt, so none of that logic is duplicated.
 *
 * ANDROID ONLY. ShapeChallengeScreen renders it behind
 * `Capacitor.isNativePlatform()`, and the web keeps the existing markup exactly
 * as it was.
 *
 * NOTHING FROM THE MOCKUP IS COPIED. Version B's frame shows "ACCURACY 94%",
 * five stars, a compass star and 96/92/89/97. None of that appears here: the
 * score is the product's own number with no percent sign and no "Accuracy"
 * label (Classic does not present it that way), the metrics are the real
 * breakdown, the tip is the real `improvementTip`, and "New best" shows only
 * when the round actually was one.
 */
import type { ReactNode, RefObject } from "react";
import type { ScoreBreakdown } from "../types/Score";
import "../styles/appShell.css";

/** One row of the breakdown. `value` drives the bar width directly. */
type Metric = { label: string; value: number };

type ClassicResultNativeProps = {
  /** Shown in the compact header, so the player knows what they drew. */
  shapeName: string;
  onBack: () => void;

  /** <ResultComparison variant="dark" …/>, which owns the guide toggle. */
  stage: ReactNode;

  score: ScoreBreakdown;
  /** True only when the round really set a personal best. */
  isNewBest?: boolean;
  /** The star rating element, so the thresholds stay in one place. */
  stars: ReactNode;
  /** The stored best, already formatted by the caller, or null to omit it. */
  bestLabel?: string | null;
  /** The real improvementTip output, or null when there is nothing to say. */
  tip?: string | null;

  /**
   * The primary action. When there is no next shape to offer, the caller makes
   * Try Again the primary and omits `onRetry` - the same rule the existing
   * screen already applies, just passed in rather than re-decided here.
   */
  onPrimary: () => void;
  primaryLabel: string;
  /** Extra class for the primary, e.g. the tutorial's pulse. */
  primaryClassName?: string;
  /** Secondary retry. Omitted when retrying IS the primary action. */
  onRetry?: () => void;
  onHome: () => void;
  homeLabel: string;
  /**
   * Attached to the actions container. The screen scrolls this into view for the
   * result tutorial, so the ref has to reach the same element it did before.
   */
  actionsRef?: RefObject<HTMLDivElement | null>;

  /** The reward offer, untouched, or null. */
  offer?: ReactNode;
  /** Notes and prompts the screen already renders conditionally. */
  extras?: ReactNode;
  /** Overlays that position themselves; rendered last. */
  overlays?: ReactNode;
};

export default function ClassicResultNative({
  shapeName,
  onBack,
  stage,
  score,
  isNewBest,
  stars,
  bestLabel,
  tip,
  onPrimary,
  primaryLabel,
  primaryClassName,
  onRetry,
  onHome,
  homeLabel,
  actionsRef,
  offer,
  extras,
  overlays,
}: ClassicResultNativeProps) {
  /*
   * The four real sub-scores. Order matches the design; the values and their
   * meaning come straight from the scorer - this only reads them.
   */
  const metrics: Metric[] = [
    { label: "Shape", value: score.shapeMatch },
    { label: "Coverage", value: score.coverage },
    { label: "Smoothness", value: score.smoothness },
    { label: "Scale", value: score.scale },
  ];

  return (
    <div className="screen app-result">
      {/* 1 · Compact header. The global AppHeader carries coins, chests, the
          crown and four shortcuts, none of which a result needs - and it cost
          164px of a 738px screen. Back and the shape name are what this screen
          is about. The global header is not modified; it is simply not used
          here, and only on native. */}
      <header className="app-result-head">
        <button type="button" className="app-result-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <span className="app-result-title">Result</span>
        <span className="app-result-shape">{shapeName}</span>
      </header>

      {/* 2 · The stage: the drawing is the first thing on the screen. */}
      <section className="app-result-stage">{stage}</section>

      {/* 3 · One card: the score, its status, and the real breakdown. */}
      <section className="app-result-card">
        <div className="app-result-scorerow">
          <div className="app-result-scorebox">
            {/* The product's own number. No percent sign, no invented label. */}
            <strong className="app-result-score">{score.total}</strong>
            <span className="app-result-message">{score.message}</span>
          </div>
          <div className="app-result-status">
            {stars}
            {/* ScoreCard's exact wording, so the badge is not new copy. */}
            {isNewBest && <span className="app-result-best">New personal best!</span>}
            {bestLabel && <span className="app-result-bestline">{bestLabel}</span>}
          </div>
        </div>

        <ul className="app-result-metrics">
          {metrics.map((metric) => (
            <li className="app-result-metric" key={metric.label}>
              <span className="app-result-metric-label">{metric.label}</span>
              {/* The bar is presentation over the real value - the width IS the
                  score, clamped only so a stray out-of-range value cannot
                  overflow the row. Nothing is recalculated. */}
              <span className="app-result-bar">
                <span
                  className="app-result-bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, metric.value))}%` }}
                />
              </span>
              <strong className="app-result-metric-value">{metric.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      {offer}
      {extras}

      {/* 4 · Actions. Primary first and full width, the two ways back beside
          each other under it. */}
      <footer className="app-result-actions" ref={actionsRef}>
        <button
          type="button"
          className={primaryClassName ? `app-result-primary ${primaryClassName}` : "app-result-primary"}
          onClick={onPrimary}
        >
          {primaryLabel}
        </button>
        <div className="app-result-secondaries">
          {onRetry && (
            <button type="button" className="app-result-secondary" onClick={onRetry}>
              Try Again
            </button>
          )}
          <button type="button" className="app-result-secondary" onClick={onHome}>
            {homeLabel}
          </button>
        </div>
      </footer>

      {/* 5 · The tip, after the actions.
          It used to sit inside the card, where Version B has it - but measured
          at 392×738 that pushed the primary action to 745-797px, below the
          738px fold, and the longest of the four real tips (the Smoothness one,
          196 characters) was the worst case. The tip is secondary: it is advice
          for the NEXT attempt, while the actions are what the player came here
          to do. So it moves below them and the primary stays reachable without
          scrolling at any tip length. This is a deliberate, approved departure
          from the mockup's card composition. */}
      {tip && (
        <p className="app-result-tip">
          <span className="app-result-tip-label">Tip</span>
          <span>{tip}</span>
        </p>
      )}

      {overlays}
    </div>
  );
}
