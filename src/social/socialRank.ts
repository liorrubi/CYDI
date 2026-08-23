/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Social Rank: the ladder Social Points climb.
//
// DERIVED, NEVER STORED. Everything here is a function of the single `total`
// already in `cydi.social.v1`, so the stored record stays exactly as it was and
// a future change to the thresholds re-ranks every existing player correctly
// instead of leaving them on a rank that no longer matches their points. There
// is nothing to migrate because there is nothing extra to persist.
//
// Points are XP. Nothing on this ladder spends or subtracts them.
import { SOCIAL_POINTS_ICON } from "./socialRewards";

export type SocialRank = {
  id: string;
  name: string;
  /** Total points at which this rank begins. */
  threshold: number;
};

/**
 * The ladder, in ascending order.
 *
 * Gaps widen deliberately (10, 15, 25, 50, 100): the first promotion should
 * arrive after a few matches so the bar visibly means something, while the top
 * of the ladder stays a long-term goal. CYDI Master is the maximum and stays
 * the maximum - no endless prestige levels invented ahead of a decision to have
 * them.
 */
export const SOCIAL_RANKS: readonly SocialRank[] = [
  { id: "rookie", name: "Rookie", threshold: 0 },
  { id: "challenger", name: "Challenger", threshold: 10 },
  { id: "competitor", name: "Competitor", threshold: 25 },
  { id: "socialArtist", name: "Social Artist", threshold: 50 },
  { id: "champion", name: "Champion", threshold: 100 },
  { id: "cydiMaster", name: "CYDI Master", threshold: 200 },
];

export const MAX_RANK = SOCIAL_RANKS[SOCIAL_RANKS.length - 1];

/** Index of the rank a total sits in. */
export function rankIndexFor(points: number): number {
  const total = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  let index = 0;
  for (let i = 0; i < SOCIAL_RANKS.length; i++) {
    if (total >= SOCIAL_RANKS[i].threshold) index = i;
  }
  return index;
}

export function rankFor(points: number): SocialRank {
  return SOCIAL_RANKS[rankIndexFor(points)];
}

export type RankProgress = {
  rank: SocialRank;
  rankIndex: number;
  /** The rank being climbed towards, or null at the top. */
  next: SocialRank | null;
  points: number;
  /** Points banked inside the current band. */
  earnedInRank: number;
  /** Width of the current band in points; 0 at the top. */
  rankSpan: number;
  /** Points still needed for the next rank; 0 at the top. */
  pointsToNext: number;
  /** 0..1, for the bar. Exactly 1 at the top rank, which is shown as complete rather than empty. */
  fraction: number;
  isMax: boolean;
  /** "37 / 50" while climbing, or the plain total at the top. Read out as-is, so progress never depends on colour. */
  label: string;
};

export function rankProgress(points: number): RankProgress {
  const total = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  const rankIndex = rankIndexFor(total);
  const rank = SOCIAL_RANKS[rankIndex];
  const next = SOCIAL_RANKS[rankIndex + 1] ?? null;

  if (!next) {
    return {
      rank,
      rankIndex,
      next: null,
      points: total,
      earnedInRank: total - rank.threshold,
      rankSpan: 0,
      pointsToNext: 0,
      // A full bar at the top reads as "completed the ladder". An empty one
      // would read as "no progress", which is the opposite of the truth.
      fraction: 1,
      isMax: true,
      label: `${total}`,
    };
  }

  const rankSpan = next.threshold - rank.threshold;
  const earnedInRank = total - rank.threshold;
  return {
    rank,
    rankIndex,
    next,
    points: total,
    earnedInRank,
    rankSpan,
    pointsToNext: next.threshold - total,
    fraction: Math.max(0, Math.min(1, earnedInRank / rankSpan)),
    isMax: false,
    label: `${total} / ${next.threshold}`,
  };
}

/**
 * The ranks newly reached going from one total to another.
 *
 * Returns every rank crossed, not just the final one, so an award big enough to
 * jump two bands is celebrated as two promotions rather than silently
 * collapsing into one. (Three points cannot do that today; a future reward, a
 * restored backup or a changed ladder can.)
 */
export function crossedRanks(from: number, to: number): SocialRank[] {
  const start = rankIndexFor(from);
  const end = rankIndexFor(to);
  if (end <= start) return [];
  return SOCIAL_RANKS.slice(start + 1, end + 1);
}

/** Whether an award is worth animating at all. Zero means it was already banked - a reconnect, a remount, a revisit - and nothing should move or celebrate. */
export function shouldAnimateAward(pointsAwarded: number): boolean {
  return pointsAwarded > 0;
}

/** Base length of the count-up, in ms. */
export const RANK_TWEEN_BASE_MS = 900;
/** Added per rank crossed, so a promotion has room to land without making anyone wait for Rematch. */
export const RANK_TWEEN_PER_RANK_MS = 350;
export const RANK_TWEEN_MAX_MS = 2000;

/**
 * How long the bar should take.
 *
 * Zero under `prefers-reduced-motion`: the numbers jump straight to their final
 * values and the promotion is still announced, just not animated.
 */
export function tweenDurationMs(ranksCrossed: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.min(RANK_TWEEN_MAX_MS, RANK_TWEEN_BASE_MS + Math.max(0, ranksCrossed) * RANK_TWEEN_PER_RANK_MS);
}

/** "🎖️ Challenger · 18" - the compact form for a mode header. */
export function compactRankLabel(points: number): string {
  return `${SOCIAL_POINTS_ICON} ${rankFor(points).name} · ${Math.max(0, Math.floor(points))}`;
}
