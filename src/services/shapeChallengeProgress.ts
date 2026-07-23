import { getLocalShapesForCategory, type ShapeDefinition } from "../content/contentRepository";
import { getSaveData, updateSaveData } from "./saveStore";

/**
 * Shape Challenge progress.
 *
 * TWO REPRESENTATIONS, KEPT IN SYNC:
 * - `completedShapeIdsByCategory` (v2, authoritative when present): the stable
 *   shape ids the player has completed, per category. Because it names shapes
 *   by id, inserting new shapes into a category later can never lock a player
 *   out of something they already completed.
 * - `levelIndexByCategory` (legacy mirror): the old "how many shapes deep into
 *   this category" counter. Still written on every save so that (a) rolling
 *   back to an older app build and (b) importing this save via a save code
 *   into an older build both keep working. Never removed from the schema.
 *
 * READ PATH: helpers below prefer v2 and lazily DERIVE it from the legacy
 * counter when absent (a save written by an older build): the first N shapes
 * of the category, IN BAKED-IN LEVEL ORDER — exactly the set the old
 * `index <= levelIndex` rule treated as completed. The baked order (not the
 * active, possibly-remote catalog) is deliberate: a legacy counter was only
 * ever written by a build with no remote content, so that is the order it was
 * accumulated under; deriving against a remote catalog that inserted/reordered
 * shapes would mislabel which shapes were completed. Nothing is written during
 * reads; the derived form is persisted on the next `saveProgress`.
 */
export type ShapeChallengeProgress = {
  levelIndexByCategory: Record<string, number>;
  completedShapeIdsByCategory?: Record<string, string[]>;
  bestScores: Record<string, number>;
};

export function getProgress(): ShapeChallengeProgress {
  return getSaveData().progress.shapeChallenge;
}

export function saveProgress(progress: ShapeChallengeProgress): void {
  const normalized = normalizeProgress(progress);
  updateSaveData((data) => {
    data.progress.shapeChallenge = normalized;
  });
}

export function clearProgress(): ShapeChallengeProgress {
  const empty: ShapeChallengeProgress = { levelIndexByCategory: {}, completedShapeIdsByCategory: {}, bestScores: {} };
  saveProgress(empty);
  return empty;
}

/**
 * Completed shape ids for a category, v2-first with legacy derivation (see the
 * module note). The derived prefix is capped to the category's current size,
 * so a legacy counter larger than the category can never invent unknown ids.
 */
export function getCompletedShapeIds(progress: ShapeChallengeProgress, category: string): string[] {
  const stored = progress.completedShapeIdsByCategory?.[category];
  if (stored) return stored;
  const legacyCount = progress.levelIndexByCategory[category] ?? 0;
  if (legacyCount <= 0) return [];
  // Baked order - see the module note on the read path.
  const shapes = getLocalShapesForCategory(category);
  return shapes.slice(0, Math.min(legacyCount, shapes.length)).map((shape) => shape.id);
}

/**
 * Number of completed shapes in a category. Matches the legacy raw
 * `levelIndexByCategory` value exactly for saves written by older builds
 * (including a counter that exceeds the category size, which older UI code
 * capped only at display time — callers that render "X of Y" still cap).
 */
export function getCategoryCompletedCount(progress: ShapeChallengeProgress, category: string): number {
  const stored = progress.completedShapeIdsByCategory?.[category];
  if (stored) return stored.length;
  return progress.levelIndexByCategory[category] ?? 0;
}

/** Total completed shapes across all categories — the journey/achievements counter (was: sum of levelIndexByCategory). */
export function getTotalCompletedCount(progress: ShapeChallengeProgress): number {
  const categories = new Set([
    ...Object.keys(progress.levelIndexByCategory),
    ...Object.keys(progress.completedShapeIdsByCategory ?? {}),
  ]);
  let total = 0;
  for (const category of categories) total += getCategoryCompletedCount(progress, category);
  return total;
}

export function isShapeCompleted(progress: ShapeChallengeProgress, category: string, shapeId: string): boolean {
  return getCompletedShapeIds(progress, category).includes(shapeId);
}

/**
 * Index of the frontier shape — the first not-yet-completed shape in the
 * category's current level order; `shapes.length` when everything is done.
 * The frontier is the one locked-by-default shape the player may attempt next.
 */
export function getFrontierIndex(progress: ShapeChallengeProgress, category: string, shapes: ShapeDefinition[]): number {
  const completed = new Set(getCompletedShapeIds(progress, category));
  for (let i = 0; i < shapes.length; i++) {
    if (!completed.has(shapes[i].id)) return i;
  }
  return shapes.length;
}

/**
 * Unlock rule: a shape is playable if the player already completed it, or it
 * is the current frontier. For the prefix-shaped progress normal play
 * produces, this is exactly the old `index <= levelIndex` rule — but stated
 * in ids, so shapes added later can't shift what an existing player unlocked.
 */
export function isShapeUnlockedAt(
  progress: ShapeChallengeProgress,
  category: string,
  shapes: ShapeDefinition[],
  index: number,
): boolean {
  const shape = shapes[index];
  if (!shape) return false;
  return isShapeCompleted(progress, category, shape.id) || index === getFrontierIndex(progress, category, shapes);
}

/** Returns new progress with `shapeId` recorded as completed (id list + legacy mirror both updated). No-op if already completed. */
export function markShapeCompleted(
  progress: ShapeChallengeProgress,
  category: string,
  shapeId: string,
): ShapeChallengeProgress {
  const completed = getCompletedShapeIds(progress, category);
  if (completed.includes(shapeId)) return progress;
  const updatedCompleted = [...completed, shapeId];
  return {
    ...progress,
    completedShapeIdsByCategory: { ...(progress.completedShapeIdsByCategory ?? {}), [category]: updatedCompleted },
    levelIndexByCategory: { ...progress.levelIndexByCategory, [category]: updatedCompleted.length },
  };
}

/**
 * Fills in the v2 id lists for every category the legacy counter knows about,
 * and re-mirrors the legacy counters from the id lists — the dual-write that
 * keeps old builds / old save codes working. A legacy counter for a category
 * the current catalog doesn't know (no shapes to name) is preserved verbatim
 * rather than zeroed, so no data is ever destroyed by normalizing.
 */
export function normalizeProgress(progress: ShapeChallengeProgress): ShapeChallengeProgress {
  const levelIndexByCategory = { ...progress.levelIndexByCategory };
  const completedShapeIdsByCategory = { ...(progress.completedShapeIdsByCategory ?? {}) };
  const categories = new Set([...Object.keys(levelIndexByCategory), ...Object.keys(completedShapeIdsByCategory)]);

  for (const category of categories) {
    // Baked order for legacy derivation - see the module note on the read path.
    const shapes = getLocalShapesForCategory(category);
    if (!completedShapeIdsByCategory[category]) {
      if (shapes.length === 0) continue; // unknown category: keep the legacy counter untouched, derive nothing
      const legacyCount = Math.min(levelIndexByCategory[category] ?? 0, shapes.length);
      completedShapeIdsByCategory[category] = shapes.slice(0, legacyCount).map((shape) => shape.id);
    }
    levelIndexByCategory[category] = completedShapeIdsByCategory[category].length;
  }

  return { levelIndexByCategory, completedShapeIdsByCategory, bestScores: progress.bestScores };
}
