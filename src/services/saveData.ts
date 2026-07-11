import { DEFAULT_DIFFICULTY, DEFAULT_PEN_COLOR, type ChestTierId, type DifficultyLevel, type PenColorId } from "../app/constants";
import type { Challenge } from "../types/Challenge";

export const SAVE_SCHEMA_VERSION = 1;

export type SaveData = {
  schemaVersion: number;
  updatedAt: number;
  progress: {
    coins: number;
    shapeChallenge: {
      levelIndexByCategory: Record<string, number>;
      bestScores: Record<string, number>;
    };
    achievements: string[];
    unlockedCategories: string[];
    unlockedPenColors: PenColorId[];
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
    challenges: Challenge[];
    sharedChallengeIds: string[];
  };
  settings: {
    selectedPenColor: PenColorId;
    difficulty: DifficultyLevel;
    soundEnabled: boolean;
  };
};

export function createDefaultSaveData(): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    progress: {
      coins: 0,
      shapeChallenge: { levelIndexByCategory: {}, bestScores: {} },
      achievements: [],
      unlockedCategories: [],
      unlockedPenColors: [],
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
      challenges: [],
      sharedChallengeIds: [],
    },
    settings: {
      selectedPenColor: DEFAULT_PEN_COLOR,
      difficulty: DEFAULT_DIFFICULTY,
      soundEnabled: true,
    },
  };
}
