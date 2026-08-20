/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Everything a finished Shape Challenge round is allowed to change, in one place.
//
// Lifted out of ShapeChallengeScreen so the rule that matters most can be proved
// without a DOM: a PRACTICE round - the one-off round an SEO landing page opens
// on a shape the player has not unlocked (see src/seo/landingPages.ts) - must be
// completely neutral. It is scored, displayed and celebrated like any other
// round, but it persists nothing whatsoever: no best score, no coins, no
// completion, no category unlock, no round counters, no achievement input.
//
// The guarantee is structural rather than a list of guards: `resolveShapeRound`
// returns `persist: null` for a practice round, and `applyShapeRoundOutcome` is
// the ONLY place a round writes anything. Nothing to keep in sync, and nothing a
// future round-completion side effect can quietly slip past - as long as it is
// added here, behind the same null check.
import { coinsForStars, starRatingForScore } from "./constants";
import type { AnalyticsEventName, GameType } from "../services/analyticsSchema";
import { addCoins } from "../services/coinsStore";
import { recordRoundCompleted } from "../services/tutorialStore";
import { recordSuccessfulDrawing } from "../services/successfulDrawingsStore";
import { markShapeCompleted, saveProgress, type ShapeChallengeProgress } from "../services/shapeChallengeProgress";

export type ShapeRoundInput = {
  progress: ShapeChallengeProgress;
  category: string;
  shapeId: string;
  levelIndex: number;
  /** First not-yet-completed shape in the category - the only index whose pass advances progress. */
  frontierIndex: number;
  /** The attempt's total score, 0-100. */
  score: number;
  passScore: number;
  /** A landing page's one-off round: scored and shown, never persisted. */
  practice: boolean;
};

export type ShapeRoundOutcome = {
  passed: boolean;
  /**
   * Whether to celebrate a personal best. Always false on a practice round: the
   * score is not kept, so there is no new best to claim.
   */
  isNewBest: boolean;
  /** Everything this round may write - or null when it may write nothing at all. */
  persist: {
    progress: ShapeChallengeProgress;
    advancesFrontier: boolean;
    /** Only the star-tier improvement over the shape's previous best (see below); never negative. */
    coins: number;
    countsAsSuccessfulDrawing: boolean;
  } | null;
};

/**
 * How the round reports itself to analytics. A practice round is NOT suppressed -
 * SEO-practice usage is worth measuring - but it must never be mistaken for normal
 * play, so it reports under its own game type and its own completion event rather
 * than as a "shapeChallenge" round. See the schema for why a param would not do.
 */
export function roundGameType(practice: boolean): GameType {
  return practice ? "seoPractice" : "shapeChallenge";
}

/** The round-result event name for this kind of round - the mirrored twin for practice. */
export function roundCompletedEvent(practice: boolean): Extract<AnalyticsEventName, "shape_completed" | "shape_practice_completed"> {
  return practice ? "shape_practice_completed" : "shape_completed";
}

/** Pure: decides what the round earned and what may be written. No side effects, so it is safe to call from anywhere. */
export function resolveShapeRound(input: ShapeRoundInput): ShapeRoundOutcome {
  const { progress, category, shapeId, levelIndex, frontierIndex, score, passScore, practice } = input;
  const passed = score >= passScore;
  // The one early return that makes a practice round neutral. Everything below
  // this line - progression, coins, counters - is unreachable for one.
  if (practice) return { passed, isNewBest: false, persist: null };

  const bestScore = progress.bestScores[shapeId];
  const beatBest = bestScore === undefined || score > bestScore;
  // The frontier - the first not-yet-completed shape - is the only shape whose pass advances progress.
  const advancesFrontier = passed && levelIndex === frontierIndex;
  const progressAfterPass = advancesFrontier ? markShapeCompleted(progress, category, shapeId) : progress;
  // Pay out only the improvement over the shape's previous best - not the full
  // reward for the new star tier every time. Otherwise climbing 3 stars, then
  // 5 stars, on the same shape would pay both tiers in full (35 + 80), more
  // than acing it in one attempt (80) ever would. Replaying at the same or a
  // lower star count earns nothing, since the delta is zero or negative.
  const previousStars = bestScore !== undefined ? starRatingForScore(bestScore) : -1;
  const coins = coinsForStars(starRatingForScore(score)) - coinsForStars(previousStars);
  return {
    passed,
    isNewBest: beatBest,
    persist: {
      progress: {
        ...progressAfterPass,
        bestScores: { ...progressAfterPass.bestScores, [shapeId]: beatBest ? score : bestScore! },
      },
      advancesFrontier,
      coins: Math.max(coins, 0),
      countsAsSuccessfulDrawing: passed,
    },
  };
}

/**
 * Performs every persistent write the round is entitled to - and, for a practice
 * round, none at all. Returns the coin amount an ad-double offer may be made for
 * (0 = no offer), which is the caller's only remaining decision.
 */
export function applyShapeRoundOutcome(
  outcome: ShapeRoundOutcome,
  onProgressChange: (progress: ShapeChallengeProgress) => void,
): number {
  if (!outcome.persist) return 0;
  const { progress, coins, countsAsSuccessfulDrawing } = outcome.persist;
  saveProgress(progress);
  // Recorded before onProgressChange so that achievement detection (which
  // reads shouldShowAchievementsTutorial to decide whether to suppress the
  // "First Steps" banner in favor of the achievements tutorial) already
  // sees this round counted.
  recordRoundCompleted();
  if (countsAsSuccessfulDrawing) recordSuccessfulDrawing();
  onProgressChange(progress);
  if (coins > 0) addCoins(coins);
  return coins;
}
