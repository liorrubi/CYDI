import assert from "node:assert/strict";
import test from "node:test";
import { SHAPE_LIBRARY } from "../engine/shapeLibrary.ts";
import { GENERATED_SHAPE_DIFFICULTY } from "./shapeDifficultyTable.ts";
import { DIFFICULTY_OVERRIDES, difficultyForShape, MULTIPLAYER_EXCLUSIONS, pickShapeSequence, poolFor, poolSizes } from "./difficultyPool.ts";
import { auditPools, shouldExclude } from "../../scripts/auditMultiplayerPools.ts";

test("every shape in the library has a computed difficulty", () => {
  const missing = SHAPE_LIBRARY.filter((s) => !(s.id in GENERATED_SHAPE_DIFFICULTY)).map((s) => s.id);
  assert.deepEqual(missing, [], "regenerate with `npm run shape-difficulty` after adding shapes");
});

test("the generated table has no stale ids", () => {
  const known = new Set(SHAPE_LIBRARY.map((s) => s.id));
  const stale = Object.keys(GENERATED_SHAPE_DIFFICULTY).filter((id) => !known.has(id));
  assert.deepEqual(stale, [], "a renamed or removed shape is still listed");
});

test("the three tiers partition the whole library, minus the multiplayer exclusions", () => {
  // Every shape lands in exactly one tier, except the handful held out of
  // Play Together for not fitting a 20-second round (they stay in the
  // single-player game).
  const sizes = poolSizes();
  assert.equal(sizes.easy + sizes.medium + sizes.hard, SHAPE_LIBRARY.length - MULTIPLAYER_EXCLUSIONS.size);
});

test("no tier is empty or lopsided", () => {
  const sizes = poolSizes();
  for (const [tier, size] of Object.entries(sizes)) {
    assert.ok(size > 0, `${tier} is empty`);
    // Terciles, so each tier should be near a third. A generous band still
    // catches a heuristic change that collapses the distribution.
    assert.ok(size > SHAPE_LIBRARY.length / 6, `${tier} has collapsed to ${size}`);
  }
});

test("hand overrides win over the computed tier", () => {
  const sample = SHAPE_LIBRARY[0].id;
  const computed = GENERATED_SHAPE_DIFFICULTY[sample];
  assert.equal(difficultyForShape(sample), DIFFICULTY_OVERRIDES[sample] ?? computed);
  // The override map is the documented correction point and must stay wired up
  // even while it is empty.
  assert.equal(typeof DIFFICULTY_OVERRIDES, "object");
});

test("difficultyForShape falls back to medium for an unknown id", () => {
  assert.equal(difficultyForShape("no-such-shape-at-all"), "medium");
});

test("mixed draws from the entire library, minus the exclusions", () => {
  // Mixed is the default setting, so an exclusion leaking back in here would
  // affect most rooms.
  assert.equal(poolFor("mixed").length, SHAPE_LIBRARY.length - MULTIPLAYER_EXCLUSIONS.size);
});

test("each tier pool contains only shapes of that tier", () => {
  for (const tier of ["easy", "medium", "hard"] as const) {
    for (const id of poolFor(tier)) {
      assert.equal(difficultyForShape(id), tier, `${id} is in the ${tier} pool but rated ${difficultyForShape(id)}`);
    }
  }
});

test("pickShapeSequence returns the requested number of distinct shapes", () => {
  for (const count of [5, 10, 15]) {
    const seq = pickShapeSequence("mixed", count);
    assert.equal(seq.length, count);
    assert.equal(new Set(seq).size, count, "a shape must not repeat inside one game");
  }
});

test("pickShapeSequence stays inside the requested tier", () => {
  const seq = pickShapeSequence("easy", 15);
  assert.equal(seq.length, 15);
  for (const id of seq) assert.equal(difficultyForShape(id), "easy");
});

test("pickShapeSequence only ever returns resolvable shape ids", () => {
  const known = new Set(SHAPE_LIBRARY.map((s) => s.id));
  for (const difficulty of ["easy", "medium", "hard", "mixed"] as const) {
    for (const id of pickShapeSequence(difficulty, 15)) {
      assert.ok(known.has(id), `${id} is not in SHAPE_LIBRARY`);
    }
  }
});

test("pickShapeSequence is deterministic given a seeded random", () => {
  const seeded = () => 0.5;
  assert.deepEqual(pickShapeSequence("hard", 5, seeded), pickShapeSequence("hard", 5, seeded));
});

test("pickShapeSequence recycles rather than failing when asked for more than the pool holds", () => {
  // Not reachable today (the smallest tier is far bigger than 15 rounds), but a
  // short game is still better than a crashed one if a tier is ever trimmed.
  const pool = poolFor("easy");
  const seq = pickShapeSequence("easy", pool.length + 3);
  assert.equal(seq.length, pool.length + 3);
});

// ------------------------------------------- fitness for a 20-second round ----
// Play Together gives 20 seconds to draw. These guard the thing that is easy to
// break by accident later: adding a shape to the library that is technically
// "hard" but that nobody can actually attempt in the time available.

test("shapes excluded from multiplayer appear in no pool, including mixed", () => {
  for (const difficulty of ["easy", "medium", "hard", "mixed"] as const) {
    for (const id of poolFor(difficulty)) {
      assert.ok(!MULTIPLAYER_EXCLUSIONS.has(id), `${id} is excluded but still in the ${difficulty} pool`);
    }
  }
});

test("excluded shapes are still part of the single-player game", () => {
  // The exclusion is about a 20-second clock, not about the shape being bad.
  const known = new Set(SHAPE_LIBRARY.map((s) => s.id));
  for (const id of MULTIPLAYER_EXCLUSIONS) {
    assert.ok(known.has(id), `${id} is excluded from multiplayer but no longer exists at all`);
  }
});

test("pickShapeSequence can never hand out an excluded shape", () => {
  for (const difficulty of ["easy", "medium", "hard", "mixed"] as const) {
    for (const id of pickShapeSequence(difficulty, 15)) {
      assert.ok(!MULTIPLAYER_EXCLUSIONS.has(id), `${difficulty} sequence contained excluded ${id}`);
    }
  }
});

test("every pool stays large enough to play 15 distinct rounds many times over", () => {
  for (const difficulty of ["easy", "medium", "hard", "mixed"] as const) {
    assert.ok(poolFor(difficulty).length >= 80, `${difficulty} has only ${poolFor(difficulty).length} shapes`);
  }
});

test("no shape in any pool needs more than the drawing window to attempt", () => {
  // The estimate is a model, not a measurement, so the bar is the window
  // itself rather than a tight fit - this catches a shape that is flatly
  // impossible, not one that is merely demanding.
  for (const row of auditPools()) {
    assert.ok(row.estSeconds < 20, `${row.name} (${row.id}, ${row.tier}) needs ~${row.estSeconds.toFixed(1)}s`);
  }
});

test("no shape fails both practicality checks at once", () => {
  // The exclusion rule itself. If a newly added shape trips this, it belongs in
  // MULTIPLAYER_EXCLUSIONS - re-run scripts/auditMultiplayerPools.ts.
  const offenders = auditPools().filter(shouldExclude).map((r) => `${r.name} (${r.id}): ~${r.estSeconds.toFixed(1)}s, ${r.parts} parts`);
  assert.deepEqual(offenders, []);
});

test("the three tiers still feel meaningfully different to draw", () => {
  // Trimming the Hard tail must not have flattened it into Medium. Hard should
  // still be a clearly bigger task, just a possible one.
  const rows = auditPools();
  const median = (tier: string) => {
    const v = rows.filter((r) => r.tier === tier).map((r) => r.estSeconds).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const easy = median("easy");
  const medium = median("medium");
  const hard = median("hard");
  assert.ok(medium > easy * 1.4, `medium (${medium.toFixed(1)}s) is not meaningfully slower than easy (${easy.toFixed(1)}s)`);
  assert.ok(hard > medium * 1.4, `hard (${hard.toFixed(1)}s) is not meaningfully slower than medium (${medium.toFixed(1)}s)`);
  // And Hard must still use a real part of the window, or it is not Hard.
  assert.ok(hard >= 8, `hard median is only ${hard.toFixed(1)}s`);
});
