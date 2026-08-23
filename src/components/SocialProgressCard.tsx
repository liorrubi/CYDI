/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Confetti from "./multiplayer/Confetti";
import { playRoundWinSound } from "../engine/soundEngine";
import { hapticRoundWin } from "../services/haptics";
import { SOCIAL_POINTS_ICON, SOCIAL_POINTS_LABEL } from "../social/socialRewards";
import { crossedRanks, rankFor, rankProgress, shouldAnimateAward, tweenDurationMs } from "../social/socialRank";

type SocialProgressCardProps = {
  /** The tally before this match. Equal to `total` when nothing was awarded. */
  previousTotal: number;
  total: number;
  /** Points this match earned. 0 means it was already banked, so nothing animates and nothing is celebrated. */
  pointsAwarded: number;
};

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Ease-out: most of the movement happens early, so the bar feels responsive rather than slow. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/**
 * The after-match progress card: rank, points, and a full-width bar toward the
 * next rank.
 *
 * Deliberately prominent rather than a decorative hairline - it is the one
 * moment the player is told that another game gets them somewhere, and it has
 * to survive being glanced at on a phone.
 *
 * The animation is a single count-up on the POINTS. Everything else - the bar
 * fraction, the rank name, the "13 to go" line - is derived from that number as
 * it moves, which means a promotion mid-tween happens for free: the bar fills,
 * flips to the new band and carries on. Crossing two thresholds at once works
 * for the same reason, with no special case.
 */
export default function SocialProgressCard({ previousTotal, total, pointsAwarded }: SocialProgressCardProps) {
  const animate = shouldAnimateAward(pointsAwarded);
  const from = animate ? previousTotal : total;

  const [displayed, setDisplayed] = useState(from);
  const [promotion, setPromotion] = useState<string | null>(null);
  const celebratedRef = useRef(false);

  useEffect(() => {
    const promotions = crossedRanks(from, total);
    const reduced = prefersReducedMotion();
    const duration = tweenDurationMs(promotions.length, reduced);

    // A promotion is announced either way; only the movement is dropped when
    // the player has asked for less of it.
    const announce = () => {
      if (promotions.length === 0 || celebratedRef.current) return;
      celebratedRef.current = true;
      setPromotion(promotions[promotions.length - 1].name);
      if (!reduced) {
        // Smaller than the champion beat by design: a shorter sound and a
        // lighter tap, so the end-of-match celebration stays the bigger moment.
        playRoundWinSound();
        hapticRoundWin();
      }
    };

    if (duration === 0 || from === total) {
      setDisplayed(total);
      announce();
      return;
    }

    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const value = Math.round(from + (total - from) * easeOut(t));
      setDisplayed(value);
      if (rankFor(value).id !== rankFor(from).id) announce();
      if (t < 1) raf = requestAnimationFrame(step);
      else setDisplayed(total);
    };
    raf = requestAnimationFrame(step);

    /*
     * requestAnimationFrame does not run while the page is hidden, and the end
     * of a match is a moment people genuinely background the app in - tapping a
     * notification, showing someone the score, locking the phone. Without this
     * the card would sit frozen on the pre-match total and a promotion would
     * never be announced at all, because the only code that announces it lives
     * in a callback that is not being called.
     *
     * A plain timer settles the final state regardless. It cannot double-count:
     * setting the total twice is idempotent, and `announce` guards itself.
     */
    const settle = window.setTimeout(() => {
      setDisplayed(total);
      announce();
    }, duration + 150);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [from, total]);

  const progress = rankProgress(displayed);
  const percent = Math.round(progress.fraction * 100);

  return (
    <section className="social-progress" aria-label="Your Social Rank">
      {promotion && !prefersReducedMotion() && <Confetti variant="round" />}

      <p className="social-progress-rank">
        <span aria-hidden="true">{SOCIAL_POINTS_ICON}</span> {progress.rank.name}
      </p>

      <p className="social-progress-points">
        {displayed} {SOCIAL_POINTS_LABEL}
      </p>

      {/*
        The numbers inside and under the bar carry the whole message on their
        own, so the fill is reinforcement rather than the only signal - which is
        what keeps this readable for anyone who cannot separate the two colours.
      */}
      <div
        className="social-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={
          progress.isMax
            ? `${progress.points} ${SOCIAL_POINTS_LABEL}. Top rank reached: ${progress.rank.name}.`
            : `${progress.points} of ${progress.next!.threshold} ${SOCIAL_POINTS_LABEL} towards ${progress.next!.name}.`
        }
      >
        <div className="social-progress-fill" style={{ "--social-fill": `${percent}%` } as CSSProperties} />
        <span className="social-progress-label">{progress.label}</span>
      </div>

      <p className="social-progress-next">
        {progress.isMax
          ? "Top rank reached — you are a CYDI Master."
          : `${progress.pointsToNext} ${progress.pointsToNext === 1 ? "point" : "points"} to ${progress.next!.name}`}
      </p>

      {promotion && (
        <p className="social-rankup" role="status">
          <span aria-hidden="true">⬆️</span> SOCIAL RANK UP! <strong>{promotion}</strong>
        </p>
      )}
    </section>
  );
}
