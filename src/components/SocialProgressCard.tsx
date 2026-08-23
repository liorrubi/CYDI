/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Confetti from "./multiplayer/Confetti";
import { playRoundWinSound } from "../engine/soundEngine";
import { hapticRoundWin } from "../services/haptics";
import { SOCIAL_POINTS_ICON, SOCIAL_POINTS_LABEL } from "../social/socialRewards";
import {
  crossedRanks,
  rankIndexFor,
  rankProgress,
  RANK_FLIP_HOLD_MS,
  shouldAnimateAward,
  tweenDurationMs,
} from "../social/socialRank";
import { setSocialPointsOverride } from "../social/socialPointsDisplay";
import { markSocialRankIntroShown, shouldShowSocialRankIntro } from "../services/multiplayerTutorialStore";

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

/** The one-line "what is this" is owed only to somebody who has just earned their first points. */
function shouldShowAnimateIntro(pointsAwarded: number): boolean {
  return pointsAwarded > 0 && shouldShowSocialRankIntro();
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
  /*
   * Which band the BAR is drawing, which deliberately lags the points during a
   * promotion. Without the lag the fill goes 90% -> 0% the instant the counter
   * ticks over, and a width transition renders that as the bar sliding
   * backwards exactly as the player is told they were promoted.
   */
  const [bandIndex, setBandIndex] = useState(() => rankIndexFor(from));
  /** Suppresses the width transition for the single frame the band flips, so the reset to 0% is a cut rather than a slide. */
  const [flipping, setFlipping] = useState(false);
  const [promotion, setPromotion] = useState<string | null>(null);
  const celebratedRef = useRef(false);
  /*
   * Explained once, and only once points have actually been paid.
   *
   * Read at mount rather than at render time so it cannot flicker off
   * mid-animation, and only armed for a real award: a player revisiting a
   * finished match, or one whose award was already banked, is not owed an
   * introduction to a system they have already been introduced to.
   */
  const [showIntro] = useState(() => shouldShowAnimateIntro(pointsAwarded));
  useEffect(() => {
    if (showIntro) markSocialRankIntroShown();
  }, [showIntro]);

  useEffect(() => {
    const promotions = crossedRanks(from, total);
    const reduced = prefersReducedMotion();
    const duration = tweenDurationMs(promotions.length, reduced);
    const targetBand = rankIndexFor(total);

    let cancelled = false;
    const timers: number[] = [];

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

    // Every path keeps the badge on the same number the card is showing, and
    // releases it once the card has arrived.
    const show = (value: number) => {
      setDisplayed(value);
      setSocialPointsOverride(value);
    };

    /**
     * Steps the bar into the next band: cut the fill back to zero without a
     * transition, then let it animate on from there. Repeats until the bar has
     * caught up with the points, so clearing two thresholds at once shows two
     * completed bars rather than one confusing jump.
     */
    const advanceBand = (band: number) => {
      if (cancelled || band >= targetBand) return;
      announce();
      setFlipping(true);
      setBandIndex(band + 1);
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setFlipping(false);
          advanceBand(band + 1);
        }, RANK_FLIP_HOLD_MS),
      );
    };

    const finish = () => {
      if (cancelled) return;
      show(total);
      if (promotions.length === 0) {
        setSocialPointsOverride(null);
        return;
      }
      // Let the completed bar be seen before the rank changes underneath it.
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          advanceBand(rankIndexFor(from));
          setSocialPointsOverride(null);
        }, RANK_FLIP_HOLD_MS),
      );
    };

    if (duration === 0 || from === total) {
      // Reduced motion: no movement at all, but the promotion is still stated.
      show(total);
      setBandIndex(targetBand);
      announce();
      setSocialPointsOverride(null);
      return () => {
        cancelled = true;
        for (const t of timers) window.clearTimeout(t);
      };
    }

    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      show(Math.round(from + (total - from) * easeOut(t)));
      if (t < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);

    /*
     * requestAnimationFrame does not run while the page is hidden, and the end
     * of a match is a moment people genuinely background the app in - tapping a
     * notification, showing someone the score, locking the phone. Without this
     * the card would sit frozen on the pre-match total and the promotion would
     * never be announced, because the only code that announces it lives in a
     * callback that is not being called.
     */
    timers.push(window.setTimeout(finish, duration + 150));

    /*
     * The hold on the badge is deliberately NOT released in this cleanup.
     *
     * StrictMode runs mount -> cleanup -> mount in development, and releasing it
     * here opened a window where the card still showed the old total while the
     * badge had already fallen back to the real one - the exact spoiler this
     * mechanism prevents, and it was visible on a real device. Ownership passes
     * upward instead: `finish` releases it, the rematch handler releases it, and
     * the screen releases it on unmount.
     */
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      for (const t of timers) window.clearTimeout(t);
    };
  }, [from, total]);

  // Pinned to the band the BAR is on, which lags the points across a promotion.
  const progress = rankProgress(displayed, bandIndex);
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
            ? `Top rank reached: ${progress.rank.name}. ${progress.points} ${SOCIAL_POINTS_LABEL} in total.`
            : `${progress.earnedInRank} of ${progress.rankSpan} towards ${progress.next!.name}. ${progress.points} ${SOCIAL_POINTS_LABEL} in total.`
        }
      >
        <div
          className={flipping ? "social-progress-fill social-progress-fill-cut" : "social-progress-fill"}
          style={{ "--social-fill": `${percent}%` } as CSSProperties}
        />
        <span className="social-progress-label">{progress.label}</span>
      </div>

      {showIntro && (
        <p className="social-progress-intro">
          <span aria-hidden="true">{SOCIAL_POINTS_ICON}</span> Social games earn Social Points and build your Social Rank.
        </p>
      )}

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
