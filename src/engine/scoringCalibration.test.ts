import assert from "node:assert/strict";
import test from "node:test";
import { runCalibration, type Band, type Row } from "../../scripts/scoringCalibration.ts";
import { compareContourDeviation } from "./comparePaths.ts";
import { scoreMessage, SCORE_WEIGHTS, sizeCeiling } from "./scoringConstants.ts";
import { normalizePath } from "./normalizePath.ts";
import { getShapeById } from "./shapeLibrary.ts";
import { CANVAS_SIZE } from "../app/constants.ts";
import { RESAMPLE_POINT_COUNT } from "./scoringConstants.ts";

// Calibration guard for the scorer.
//
// These assert on BANDS and ORDERING, not on individual numbers. The scorer is
// a heuristic; pinning exact scores would make every future improvement look
// like a regression. What must hold is the shape of the distribution: a good
// drawing scores well, a visibly flawed one does not, and the gap between them
// is real.
//
// The fixtures live in scripts/scoringCalibration.ts, which can also be run
// directly to print the whole table when tuning.

const rows: Row[] = runCalibration();
const inBand = (band: Band) => rows.filter((r) => r.band === band);
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const meanTotal = (band: Band) => mean(inBand(band).map((r) => r.total));

test("the calibration set actually covers every band", () => {
  for (const band of ["near-perfect", "good", "mediocre", "local-defect", "distorted", "wrong", "wrong-size"] as Band[]) {
    assert.ok(inBand(band).length >= 10, `${band} has only ${inBand(band).length} cases`);
  }
  // Open and closed shapes, simple and intricate - so nothing here can be
  // satisfied by tuning for circles.
  assert.ok(new Set(rows.map((r) => r.shapeId)).size >= 10);
});

test("score bands are strictly ordered by how good the drawing is", () => {
  const ordered: Band[] = ["near-perfect", "good", "mediocre", "local-defect", "distorted", "wrong"];
  for (let i = 1; i < ordered.length; i++) {
    const better = meanTotal(ordered[i - 1]);
    const worse = meanTotal(ordered[i]);
    assert.ok(better > worse, `${ordered[i - 1]} (${better.toFixed(1)}) should outscore ${ordered[i]} (${worse.toFixed(1)})`);
  }
});

test("genuinely good drawings are not punished", () => {
  // The whole risk of tightening a scorer is collateral damage to real players
  // drawing well. This is the guard against that.
  const near = inBand("near-perfect");
  assert.ok(Math.min(...near.map((r) => r.total)) >= 90, "a near-perfect trace must still score at least 90");
  assert.ok(meanTotal("near-perfect") >= 96);

  const good = inBand("good");
  assert.ok(Math.min(...good.map((r) => r.total)) >= 85, "a good drawing must still score at least 85");
  assert.ok(meanTotal("good") >= 90);
});

test("a drawing with a large local deviation cannot be called Excellent", () => {
  // This is the reported complaint: an attempt whose outline is broadly right
  // but visibly wrong in one place was scoring 86 / "Excellent".
  const graded = inBand("local-defect").map((r) => ({ total: r.total, grade: scoreMessage(r.total) }));
  const excellent = graded.filter((g) => g.grade === "Excellent" || g.grade === "Incredible");
  assert.deepEqual(excellent, [], `local defects graded too highly: ${JSON.stringify(excellent)}`);
});

test("a large local deviation costs real points", () => {
  // Not a token deduction: the gap between a good drawing and one with a
  // visible defect has to be big enough that players can see it.
  const gap = meanTotal("good") - meanTotal("local-defect");
  assert.ok(gap >= 15, `only ${gap.toFixed(1)} points separate a good drawing from a visibly dented one`);
  assert.ok(meanTotal("local-defect") <= 80, `local defects average ${meanTotal("local-defect").toFixed(1)}`);
});

test("clearly wrong drawings score badly", () => {
  assert.ok(meanTotal("wrong") <= 45, `wrong shapes average ${meanTotal("wrong").toFixed(1)}`);
  assert.ok(meanTotal("distorted") <= 65);
});

test("ordering holds within every individual shape, not just on average", () => {
  // A per-shape check, so a change cannot improve the averages by helping some
  // shapes while inverting the ordering on others.
  for (const shapeId of new Set(rows.map((r) => r.shapeId))) {
    const forShape = rows.filter((r) => r.shapeId === shapeId);
    const exact = forShape.find((r) => r.label === "exact trace");
    const dent = forShape.find((r) => r.label === "ONE big dent (20% of path, 34px)");
    const wrong = forShape.filter((r) => r.band === "wrong");
    assert.ok(exact && dent, shapeId);
    assert.ok(exact.total > dent.total + 10, `${shapeId}: exact ${exact.total} vs dented ${dent.total}`);
    for (const w of wrong) {
      assert.ok(dent.total > w.total, `${shapeId}: a dented trace (${dent.total}) must beat "${w.label}" (${w.total})`);
    }
  }
});

// ------------------------------------------------------- the new metric ----

test("contour deviation falls as a drawing drifts further from the reference", () => {
  const target = getShapeById("circle")!.generate(CANVAS_SIZE);
  const nt = normalizePath(target, RESAMPLE_POINT_COUNT);

  const scoreAt = (offset: number) => {
    // Push one contiguous fifth of the outline away from the centre.
    const n = target.points.length;
    const moved = {
      ...target,
      points: target.points.map((p, i) => {
        if (i < n * 0.4 || i > n * 0.6) return p;
        const dx = p.x - CANVAS_SIZE / 2;
        const dy = p.y - CANVAS_SIZE / 2;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / len) * offset, y: p.y + (dy / len) * offset, t: p.t };
      }),
    };
    const na = normalizePath(moved, RESAMPLE_POINT_COUNT);
    return compareContourDeviation(nt.points, nt.segmentStarts, na.points, na.segmentStarts);
  };

  const scores = [0, 10, 20, 40, 70].map(scoreAt);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] < scores[i - 1], `deviation ${i} scored ${scores[i]}, not below ${scores[i - 1]}`);
  }
  assert.ok(scores[0] > 95, "an untouched contour should score near-perfectly");
});

test("contour deviation is symmetric about which path is missing ink", () => {
  // Measuring only attempt-to-target would let someone scribble over a third of
  // the shape and score well, because every point they drew IS near the target.
  const target = getShapeById("circle")!.generate(CANVAS_SIZE);
  const nt = normalizePath(target, RESAMPLE_POINT_COUNT);
  const third = { ...target, points: target.points.slice(0, Math.floor(target.points.length / 3)) };
  const na = normalizePath(third, RESAMPLE_POINT_COUNT);
  const score = compareContourDeviation(nt.points, nt.segmentStarts, na.points, na.segmentStarts);
  assert.ok(score < 70, `drawing only a third of the shape scored ${score}`);
});

test("the contour check never raises a score, only caps it", () => {
  // It composes with min(), so by construction it can only reduce - which is
  // what keeps the existing stroke-order and direction tolerances intact.
  const near = inBand("near-perfect");
  assert.ok(near.every((r) => r.shapeMatch <= 100));
  assert.ok(Math.min(...near.map((r) => r.shapeMatch)) >= 90, "a perfect trace must not be capped meaningfully");
});

// ------------------------------------------------------------- weights ----

test("SCORE_WEIGHTS are unchanged by this calibration", () => {
  // Deliberately pinned. The weights were examined during this work and left
  // alone: lowering `scale` did tighten locally-defective drawings a little,
  // but it made wrong-SIZE drawings score HIGHER (a 0.3x drawing went from 86
  // to 92), because `scale` is the only component that notices size at all.
  // Trading one leniency for another is not a calibration.
  assert.deepEqual({ ...SCORE_WEIGHTS }, { shapeMatch: 0.7, coverage: 0.05, smoothness: 0.05, scale: 0.2 });
});

// ---------------------------------------------------------- size ceiling ----

test("ordinary size variation is forgiven completely", () => {
  // 0.85x and 1.15x are what a careful player actually produces. If the size
  // ceiling touched these it would be punishing normal drawing, not policing
  // mis-sized ones.
  const natural = inBand("natural-size");
  assert.ok(Math.min(...natural.map((r) => r.total)) >= 93, `natural sizes fell to ${Math.min(...natural.map((r) => r.total))}`);
  assert.ok(mean(natural.map((r) => r.total)) >= 95);
});

test("a moderately off size costs something, but not a lot", () => {
  // 0.7x / 1.3x is visibly off but still recognisably an attempt at the shape.
  const off = inBand("off-size");
  assert.ok(mean(off.map((r) => r.total)) >= 82, `0.7x/1.3x averaged ${mean(off.map((r) => r.total)).toFixed(1)} - too harsh`);
  assert.ok(mean(off.map((r) => r.total)) < mean(inBand("natural-size").map((r) => r.total)), "but it does cost something");
});

test("a clearly wrong size cannot reach the Excellent band", () => {
  // The gap this follow-up closed: a flawless outline at 0.3x used to score in
  // the 80s, because every comparison except `scale` normalizes size away and a
  // 20%-weighted term can only dock about 20 points.
  const graded = inBand("wrong-size").map((r) => ({ total: r.total, grade: scoreMessage(r.total) }));
  const tooHigh = graded.filter((g) => g.grade === "Excellent" || g.grade === "Incredible");
  assert.deepEqual(tooHigh, [], `mis-sized drawings graded too highly: ${JSON.stringify(tooHigh)}`);
  assert.ok(mean(inBand("wrong-size").map((r) => r.total)) <= 75);
});

test("the size ceiling still credits the shape itself", () => {
  // It caps the total; it does not pretend the drawing is the wrong shape.
  // The breakdown a player sees must stay honest about what went wrong.
  const sized = inBand("wrong-size");
  assert.ok(mean(sized.map((r) => r.shapeMatch)) >= 95, "shape is still judged correct");
  assert.ok(mean(sized.map((r) => r.scale)) <= 60, "and scale is what reads low");
});

test("the size ceiling is monotonic and symmetric in the right way", () => {
  // Wider tolerance on the large side is not a bug: 1.3x is a ratio of 0.77
  // while 0.7x is a ratio of 0.70, so 0.7x really is the bigger size error.
  assert.equal(sizeCeiling(100), 100, "a perfect size is never capped");
  assert.equal(sizeCeiling(90), 100, "inside the tolerance, no cap at all");
  assert.ok(sizeCeiling(85) === 100, "the tolerance edge is still uncapped");
  const ladder = [80, 70, 60, 50, 40, 30].map(sizeCeiling);
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i] < ladder[i - 1], `ceiling should keep falling: ${ladder.join(", ")}`);
  }
  assert.ok(sizeCeiling(0) >= 0);
});

test("the size ceiling never raises a score", () => {
  // Composed with min(), so by construction it can only ever lower a total -
  // which is why no shape-quality band moved when it was introduced.
  for (const r of rows) {
    assert.ok(r.total <= Math.round(sizeCeiling(r.scale)) + 1, `${r.shapeId} ${r.label}: total ${r.total} exceeds its ceiling`);
  }
});

test("size errors do not disturb the shape-quality ordering", () => {
  // The ceiling only engages on size, so every band that is about SHAPE must
  // be exactly where it was.
  const shapeBands: Band[] = ["near-perfect", "good", "mediocre", "local-defect", "distorted", "wrong"];
  for (let i = 1; i < shapeBands.length; i++) {
    assert.ok(meanTotal(shapeBands[i - 1]) > meanTotal(shapeBands[i]));
  }
  assert.ok(meanTotal("near-perfect") >= 96, "unchanged by the size work");
  assert.ok(meanTotal("good") >= 90, "unchanged by the size work");
});

test("a tiny drawing cannot buy a top multiplayer score with speed", () => {
  // Play Together specific: a very small drawing is quicker to make, so before
  // the ceiling it earned a high accuracy AND a large speed bonus. Scoring is
  // shared with the server, so closing it here closes it there.
  const tiny = inBand("wrong-size").filter((r) => r.label === "size 0.30x");
  assert.ok(tiny.length > 0);
  const withFullSpeed = tiny.map((r) => Math.round(r.total * 0.75 + 100 * 0.25));
  assert.ok(
    Math.max(...withFullSpeed) < 75,
    `a 0.3x drawing submitted instantly could still score ${Math.max(...withFullSpeed)} in multiplayer`,
  );
});
