import { DEFAULT_DIFFICULTY, DEFAULT_PEN_COLOR, type DifficultyLevel, type PenColorId } from "../app/constants";
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
    completedRounds: number;
    achievementsTutorialShown: boolean;
    myChallengesTutorialShown: boolean;
    challenges: Challenge[];
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
      completedRounds: 0,
      achievementsTutorialShown: false,
      myChallengesTutorialShown: false,
      challenges: [],
    },
    settings: {
      selectedPenColor: DEFAULT_PEN_COLOR,
      difficulty: DEFAULT_DIFFICULTY,
      soundEnabled: true,
    },
  };
}
