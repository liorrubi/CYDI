import test from "node:test";
import assert from "node:assert/strict";

// Pure helpers only - getProgress/saveProgress touch localStorage and are not
// exercised here; everything below runs on plain objects, exactly the way the
// screens use the helpers.
const {
  getCategoryCompletedCount,
  getCompletedShapeIds,
  getFrontierIndex,
  getTotalCompletedCount,
  isShapeCompleted,
  isShapeUnlockedAt,
  markShapeCompleted,
  normalizeProgress,
} = await import("./shapeChallengeProgress.ts");

const { getShapesForCategory, getCategories } = await import("../content/contentRepository.ts");

type Progress = {
  levelIndexByCategory: Record<string, number>;
  completedShapeIdsByCategory?: Record<string, string[]>;
  bestScores: Record<string, number>;
};

function legacyProgress(levelIndexByCategory: Record<string, number>): Progress {
  // A save exactly as an older build wrote it: no completedShapeIdsByCategory at all.
  return { levelIndexByCategory, bestScores: {} };
}

const CATEGORY = getCategories()[0].id; // first (free) category - guaranteed to exist
const SHAPES = getShapesForCategory(CATEGORY);

// ---------- Legacy migration: a v1 numeric save must mean exactly what it used to.

test("legacy levelIndex derives the first-N shape ids in level order", () => {
  const progress = legacyProgress({ [CATEGORY]: 3 });
  assert.deepEqual(
    getCompletedShapeIds(progress, CATEGORY),
    SHAPES.slice(0, 3).map((s) => s.id),
  );
});

test("legacy levelIndex larger than the category caps at the category size", () => {
  const progress = legacyProgress({ [CATEGORY]: SHAPES.length + 50 });
  assert.equal(getCompletedShapeIds(progress, CATEGORY).length, SHAPES.length);
});

test("unlock rule matches the old `index <= levelIndex` rule for every legacy level", () => {
  for (let levelIndex = 0; levelIndex <= SHAPES.length; levelIndex++) {
    const progress = legacyProgress({ [CATEGORY]: levelIndex });
    for (let index = 0; index < SHAPES.length; index++) {
      assert.equal(
        isShapeUnlockedAt(progress, CATEGORY, SHAPES, index),
        index <= levelIndex,
        `levelIndex=${levelIndex}, index=${index}`,
      );
    }
  }
});

test("completed counts and totals match the legacy raw values", () => {
  const progress = legacyProgress({ [CATEGORY]: 4, "some-other": 2 });
  assert.equal(getCategoryCompletedCount(progress, CATEGORY), 4);
  assert.equal(getCategoryCompletedCount(progress, "some-other"), 2);
  assert.equal(getTotalCompletedCount(progress), 6);
  assert.equal(getCategoryCompletedCount(progress, "untouched"), 0);
});

// ---------- v2 semantics: ids are authoritative and index-independent.

test("v2 id list is preferred over the legacy counter when both exist", () => {
  const progress: Progress = {
    levelIndexByCategory: { [CATEGORY]: 99 },
    completedShapeIdsByCategory: { [CATEGORY]: [SHAPES[0].id] },
    bestScores: {},
  };
  assert.deepEqual(getCompletedShapeIds(progress, CATEGORY), [SHAPES[0].id]);
  assert.equal(getCategoryCompletedCount(progress, CATEGORY), 1);
});

test("a completed shape stays unlocked even if it is no longer inside the frontier prefix", () => {
  // Simulates "a new shape was inserted before something the player finished":
  // the player completed the shape now sitting at index 2, but not 0 or 1.
  const progress: Progress = {
    levelIndexByCategory: {},
    completedShapeIdsByCategory: { [CATEGORY]: [SHAPES[2].id] },
    bestScores: {},
  };
  assert.ok(isShapeCompleted(progress, CATEGORY, SHAPES[2].id));
  assert.ok(isShapeUnlockedAt(progress, CATEGORY, SHAPES, 2), "completed shape must stay unlocked");
  assert.equal(getFrontierIndex(progress, CATEGORY, SHAPES), 0, "frontier is the first uncompleted shape");
  assert.ok(isShapeUnlockedAt(progress, CATEGORY, SHAPES, 0), "frontier shape is playable");
  assert.ok(!isShapeUnlockedAt(progress, CATEGORY, SHAPES, 1), "beyond-frontier uncompleted shape stays locked");
});

test("frontier walks past completed shapes and lands on shapes.length when everything is done", () => {
  const all: Progress = {
    levelIndexByCategory: {},
    completedShapeIdsByCategory: { [CATEGORY]: SHAPES.map((s) => s.id) },
    bestScores: {},
  };
  assert.equal(getFrontierIndex(all, CATEGORY, SHAPES), SHAPES.length);
});

// ---------- markShapeCompleted: the only write path for advancing.

test("markShapeCompleted appends the id and mirrors the legacy counter", () => {
  let progress: Progress = legacyProgress({ [CATEGORY]: 2 });
  progress = markShapeCompleted(progress, CATEGORY, SHAPES[2].id);
  assert.deepEqual(
    progress.completedShapeIdsByCategory?.[CATEGORY],
    SHAPES.slice(0, 3).map((s) => s.id),
  );
  assert.equal(progress.levelIndexByCategory[CATEGORY], 3, "legacy mirror must advance for old builds");
});

test("markShapeCompleted is a no-op for an already-completed shape", () => {
  const progress = markShapeCompleted(legacyProgress({ [CATEGORY]: 2 }), CATEGORY, SHAPES[0].id);
  assert.equal(getCategoryCompletedCount(progress, CATEGORY), 2);
});

// ---------- normalizeProgress: the dual-write applied on every save.

test("normalizeProgress materializes id lists for legacy saves and keeps counters identical", () => {
  const normalized = normalizeProgress(legacyProgress({ [CATEGORY]: 3 }));
  assert.deepEqual(
    normalized.completedShapeIdsByCategory?.[CATEGORY],
    SHAPES.slice(0, 3).map((s) => s.id),
  );
  assert.equal(normalized.levelIndexByCategory[CATEGORY], 3);
});

test("normalizeProgress preserves a legacy counter for a category the catalog no longer knows", () => {
  const normalized = normalizeProgress(legacyProgress({ "removed-category": 7 }));
  assert.equal(normalized.levelIndexByCategory["removed-category"], 7, "must never zero unknown-category progress");
  assert.equal(normalized.completedShapeIdsByCategory?.["removed-category"], undefined);
});

test("normalizeProgress leaves bestScores untouched", () => {
  const bestScores = { [SHAPES[0].id]: 88 };
  const normalized = normalizeProgress({ levelIndexByCategory: { [CATEGORY]: 1 }, bestScores });
  assert.deepEqual(normalized.bestScores, bestScores);
});

// ---------- Cross-category isolation.

test("progress in one category never affects another", () => {
  const progress = markShapeCompleted(legacyProgress({}), CATEGORY, SHAPES[0].id);
  const other = getCategories()[1]?.id;
  assert.ok(other, "expected at least two categories");
  assert.equal(getCategoryCompletedCount(progress, other), 0);
  assert.equal(getFrontierIndex(progress, other, getShapesForCategory(other)), 0);
});
