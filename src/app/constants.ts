export const APP_NAME = "CYDI";
export const APP_TAGLINE = "Quick drawing challenges";

export const STORAGE_KEY = "cydi.challenges.v1";

export const CANVAS_SIZE = 320;

export const RESAMPLE_POINT_COUNT = 128;
export const MIN_POINTS_TO_SAVE = 8;

export const PREVIEW_DURATION_MS = 2000;
export const ANALYZING_MIN_MS = 800;
export const ANALYZING_MAX_MS = 1200;

export const CLOSED_SHAPE_OFFSET_STEP = 8;
export const CLOSED_SHAPE_CLOSURE_THRESHOLD = 0.15;

export const SCORE_WEIGHTS = {
  shapeMatch: 0.65,
  coverage: 0.2,
  smoothness: 0.1,
  scale: 0.05,
} as const;

export function scoreMessage(total: number): string {
  if (total >= 95) return "Incredible";
  if (total >= 85) return "Excellent";
  if (total >= 70) return "Nice work";
  if (total >= 50) return "Getting close";
  return "Try again";
}
