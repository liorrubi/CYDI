import { SHAPE_LIBRARY } from "../engine/shapeLibrary";
import type { ShapeChallengeProgress } from "../services/shapeChallengeProgress";

export type AchievementStats = {
  fiveStarCount: number;
  aboveNinetyCount: number;
  hasHundredScore: boolean;
  unlockedShapesCount: number;
  totalShapesCount: number;
  hasCompletedFirst: boolean;
};

export type Achievement = {
  id: string;
  icon: string;
  name: string;
  description: string;
  coinReward: number;
  target: number;
  currentValue: (stats: AchievementStats) => number;
};

export function computeAchievementStats(progress: ShapeChallengeProgress): AchievementStats {
  const scores = Object.values(progress.bestScores);
  const unlockedShapesCount = Object.values(progress.levelIndexByCategory).reduce((sum, n) => sum + n, 0);
  return {
    fiveStarCount: scores.filter((s) => s >= 95).length,
    aboveNinetyCount: scores.filter((s) => s >= 90).length,
    hasHundredScore: scores.some((s) => s === 100),
    unlockedShapesCount,
    totalShapesCount: SHAPE_LIBRARY.length,
    hasCompletedFirst: unlockedShapesCount >= 1,
  };
}

export function isAchievementUnlocked(achievement: Achievement, stats: AchievementStats): boolean {
  return achievement.currentValue(stats) >= achievement.target;
}

export function achievementProgressPercent(achievement: Achievement, stats: AchievementStats): number {
  const current = Math.min(achievement.currentValue(stats), achievement.target);
  return Math.round((current / achievement.target) * 100);
}

export function achievementProgressLabel(achievement: Achievement, stats: AchievementStats): string {
  const current = Math.min(achievement.currentValue(stats), achievement.target);
  return `${current} of ${achievement.target}`;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-steps",
    icon: "🌟",
    name: "First Steps",
    description: "Complete your first challenge",
    coinReward: 50,
    target: 1,
    currentValue: (s) => (s.hasCompletedFirst ? 1 : 0),
  },
  {
    id: "perfect-start",
    icon: "⭐",
    name: "Perfect Start",
    description: "Earn your first 5-star rating",
    coinReward: 100,
    target: 1,
    currentValue: (s) => s.fiveStarCount,
  },
  {
    id: "perfect-x3",
    icon: "⭐⭐⭐⭐⭐",
    name: "Perfect x3",
    description: "3 challenges with 5 stars",
    coinReward: 150,
    target: 3,
    currentValue: (s) => s.fiveStarCount,
  },
  {
    id: "perfect-x5",
    icon: "⭐⭐⭐⭐⭐",
    name: "Perfect x5",
    description: "5 challenges with 5 stars",
    coinReward: 250,
    target: 5,
    currentValue: (s) => s.fiveStarCount,
  },
  {
    id: "perfect-x10",
    icon: "⭐⭐⭐⭐⭐",
    name: "Perfect x10",
    description: "10 challenges with 5 stars",
    coinReward: 500,
    target: 10,
    currentValue: (s) => s.fiveStarCount,
  },
  {
    id: "perfect-x25",
    icon: "⭐⭐⭐⭐⭐",
    name: "Perfect x25",
    description: "25 challenges with 5 stars",
    coinReward: 1000,
    target: 25,
    currentValue: (s) => s.fiveStarCount,
  },
  {
    id: "perfect-x50",
    icon: "⭐⭐⭐⭐⭐",
    name: "Perfect x50",
    description: "50 challenges with 5 stars",
    coinReward: 2000,
    target: 50,
    currentValue: (s) => s.fiveStarCount,
  },
  {
    id: "precision",
    icon: "🎖️",
    name: "Precision",
    description: "10 scores above 90%",
    coinReward: 250,
    target: 10,
    currentValue: (s) => s.aboveNinetyCount,
  },
  {
    id: "expert",
    icon: "🎯",
    name: "Expert",
    description: "25 scores above 90%",
    coinReward: 700,
    target: 25,
    currentValue: (s) => s.aboveNinetyCount,
  },
  {
    id: "perfection",
    icon: "💎",
    name: "Perfection",
    description: "Score 100% on any shape",
    coinReward: 500,
    target: 1,
    currentValue: (s) => (s.hasHundredScore ? 1 : 0),
  },
  {
    id: "explorer",
    icon: "🧭",
    name: "Explorer",
    description: "Unlock 10 shapes",
    coinReward: 200,
    target: 10,
    currentValue: (s) => s.unlockedShapesCount,
  },
  {
    id: "collector",
    icon: "🧩",
    name: "Collector",
    description: "Unlock 25 shapes",
    coinReward: 500,
    target: 25,
    currentValue: (s) => s.unlockedShapesCount,
  },
  {
    id: "master-explorer",
    icon: "🧩",
    name: "Master Explorer",
    description: "Unlock every shape",
    coinReward: 3000,
    target: SHAPE_LIBRARY.length,
    currentValue: (s) => s.unlockedShapesCount,
  },
];

/** Returns achievements that are now unlocked but weren't in `alreadyUnlockedIds`. */
export function findNewlyUnlockedAchievements(stats: AchievementStats, alreadyUnlockedIds: string[]): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !alreadyUnlockedIds.includes(a.id) && isAchievementUnlocked(a, stats));
}
