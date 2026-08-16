import {
  DEFAULT_DIFFICULTY,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_SKIN,
  DEFAULT_THEME_MODE,
  type ChestTierId,
  type DifficultyLevel,
  type PenColorId,
  type PenSkinId,
  type ThemeMode,
} from "../app/constants";
import type { Challenge } from "../types/Challenge";

export const SAVE_SCHEMA_VERSION = 1;

export type SaveData = {
  schemaVersion: number;
  updatedAt: number;
  progress: {
    coins: number;
    shapeChallenge: {
      /** Legacy per-category "shapes deep" counter — kept as a dual-written mirror of `completedShapeIdsByCategory` so older builds and older save codes stay compatible (see shapeChallengeProgress.ts). */
      levelIndexByCategory: Record<string, number>;
      /** v2 progress: stable shape ids completed per category, authoritative when present. Optional because saves written by older builds don't have it; derived lazily on read. */
      completedShapeIdsByCategory?: Record<string, string[]>;
      bestScores: Record<string, number>;
    };
    achievements: string[];
    unlockedCategories: string[];
    unlockedPenColors: PenColorId[];
    /** Cosmetic pen skins the player has bought. The free default (basicPencil) is always owned even when absent here. */
    unlockedPenSkins: PenSkinId[];
    dailyStreak: {
      lastVisitDate: string;
      currentStreak: number;
      longestStreak: number;
    };
    dailyChest: {
      lastOpenedDate: string;
    };
    specialChallenge: {
      lastFreeDate: string;
      bestScores: Record<string, number>;
    };
    megaChallenge: {
      unlocked: boolean;
      unlockedCardIds: string[];
      bestScores: Record<string, number>;
      completionRewardClaimedIds: string[];
      perfectCardIds: string[];
      championCelebrated: boolean;
    };
    artistPacks: {
      bestScores: Record<string, number>;
    };
    paidChestDoubles: {
      date: string;
      count: number;
    };
    /** Timestamp (ms since epoch) each purchased chest tier becomes buyable again; absent/past = available. Shop-only, unrelated to the free Daily Chest. */
    shopChestCooldowns: Partial<Record<ChestTierId, number>>;
    successfulDrawings: number;
    completedRounds: number;
    achievementsTutorialShown: boolean;
    myChallengesTutorialShown: boolean;
    onboardingTutorialShown: boolean;
    drawingTutorialShown: boolean;
    /** The one-time "you can double this by watching a short ad" explainer on the
     * reward offer. One global flag, not one per reward type: every entry point
     * (shape/special/mega/artist challenge and the chest) renders the same
     * DoubleCoinsOffer, so seeing it once is seeing it everywhere. */
    doubleRewardTutorialShown: boolean;
    /** One-time result-screen callout pointing at the continue action. */
    resultActionsTutorialShown: boolean;
    /** Create Challenge feature discovery: whether the in-result prompt has been
     * shown once, whether its single follow-up reminder has been shown, and whether
     * the player has actually reached the Create screen (by any route). */
    createDiscoveryShown: boolean;
    createDiscoveryReminderShown: boolean;
    createFeatureDiscovered: boolean;
    challenges: Challenge[];
    sharedChallengeIds: string[];
  };
  settings: {
    selectedPenColor: PenColorId;
    /** Cosmetic pen skin currently equipped; falls back to the default if unset or not owned. */
    selectedPenSkin: PenSkinId;
    difficulty: DifficultyLevel;
    soundEnabled: boolean;
    themeMode: ThemeMode;
  };
};

export function createDefaultSaveData(): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    progress: {
      coins: 0,
      shapeChallenge: { levelIndexByCategory: {}, completedShapeIdsByCategory: {}, bestScores: {} },
      achievements: [],
      unlockedCategories: [],
      unlockedPenColors: [],
      unlockedPenSkins: [],
      dailyStreak: { lastVisitDate: "", currentStreak: 0, longestStreak: 0 },
      dailyChest: { lastOpenedDate: "" },
      specialChallenge: { lastFreeDate: "", bestScores: {} },
      megaChallenge: {
        unlocked: false,
        unlockedCardIds: [],
        bestScores: {},
        completionRewardClaimedIds: [],
        perfectCardIds: [],
        championCelebrated: false,
      },
      artistPacks: {
        bestScores: {},
      },
      paidChestDoubles: { date: "", count: 0 },
      shopChestCooldowns: {},
      successfulDrawings: 0,
      completedRounds: 0,
      achievementsTutorialShown: false,
      myChallengesTutorialShown: false,
      onboardingTutorialShown: false,
      drawingTutorialShown: false,
      doubleRewardTutorialShown: false,
      resultActionsTutorialShown: false,
      createDiscoveryShown: false,
      createDiscoveryReminderShown: false,
      createFeatureDiscovered: false,
      challenges: [],
      sharedChallengeIds: [],
    },
    settings: {
      selectedPenColor: DEFAULT_PEN_COLOR,
      selectedPenSkin: DEFAULT_PEN_SKIN,
      difficulty: DEFAULT_DIFFICULTY,
      soundEnabled: true,
      themeMode: DEFAULT_THEME_MODE,
    },
  };
}
