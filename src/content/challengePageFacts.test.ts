// The seven challenge pages deepened in wave 3 (dog, cat, triangle, lightning bolt, gear,
// star, heart) state a handful of geometry facts in their drills ("the apex sits 0.87 of the
// base above it", "the inner ring is 43% of the way out") and a few comparisons between
// scored rows ("each costs less than half of what one drifting tip costs"). The numbers that
// come from the scorer are generated; these are the ones a person typed. A typed number is
// only honest while it matches the shape, so this test re-derives every one of them from the
// real generators and the real scored examples, and fails the build when one stops being true.
import test from "node:test";
import assert from "node:assert/strict";

const { getShapeById } = await import("../engine/shapeLibrary.ts");
const { splitIntoSegments } = await import("../engine/normalizePath.ts");
const { SCORED_EXAMPLES } = await import("./scoredExamplesData.ts");

const S = 400;
type P = { x: number; y: number };

function parts(shapeId: string): P[][] {
  const shape = getShapeById(shapeId);
  assert.ok(shape, `shape ${shapeId} exists`);
  const path = shape.generate(S);
  return splitIntoSegments(path.points, path.breaks);
}

function box(points: P[]) {
  const xs = points.map((p) => p.x / S);
  const ys = points.map((p) => p.y / S);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const near = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: expected about ${expected}, got ${actual.toFixed(4)}`);

const example = (path: string) => {
  const found = SCORED_EXAMPLES.find((e) => e.path === path);
  assert.ok(found, `scored example for ${path}`);
  return found;
};

const deg = (rad: number) => (rad * 180) / Math.PI;

// ------------------------------------------------------------------ geometry ---

test("triangle: 59% wide, 51% tall, height 0.87 of the width, level base, apex over its midpoint", () => {
  const [triangle] = parts("polygon-3");
  const b = box(triangle);
  near(b.maxX - b.minX, 0.59, 0.005, "width");
  near(b.maxY - b.minY, 0.51, 0.005, "height");
  near((b.maxY - b.minY) / (b.maxX - b.minX), 0.87, 0.005, "height / width");
  near(b.maxY, 0.67, 0.005, "base sits about two-thirds of the way down");
  const apex = triangle.reduce((best, p) => (p.y < best.y ? p : best), triangle[0]);
  near(apex.x / S, (b.minX + b.maxX) / 2, 0.002, "apex over the midpoint of the base");
});

test("star: tips on a ring 70% across, inner corners on a ring 30% across, 43% of the way out", () => {
  const [star] = parts("star-5");
  const radius = (p: P) => Math.hypot(p.x - S / 2, p.y - S / 2) / S;
  near(radius(star[0]) * 2, 0.7, 0.002, "tip ring diameter");
  near(radius(star[8]) * 2, 0.3, 0.002, "inner ring diameter");
  near(radius(star[8]) / radius(star[0]), 0.43, 0.005, "inner / outer");
  // Vertices every 8 points, tip first: v2 is the right side tip, v4 the lower right tip, v6 the lower left tip.
  near(star[16].y / S, 0.39, 0.005, "side tips about 39% of the way down");
  near(star[32].y / S, 0.78, 0.005, "bottom tips about 78% of the way down");
  near((star[32].x - star[48].x) / S, 0.41, 0.005, "bottom tips about 41% of the canvas apart");
  near(star[16].y, star[64].y, 0.01, "the two side tips are level");
});

test("gear: 72% across, 32 corners, 18 degree roots, 10.8 degree tops, 45 degree pitch, teeth 10% tall", () => {
  const [gear] = parts("gear-8");
  const b = box(gear);
  near(b.maxX - b.minX, 0.72, 0.005, "width");
  assert.equal((gear.length - 1) / 4, 32, "corner count");
  const angle = (p: P) => ((deg(Math.atan2(p.y - S / 2, p.x - S / 2)) + 360) % 360);
  const radius = (p: P) => Math.hypot(p.x - S / 2, p.y - S / 2) / S;
  near(radius(gear[4]) - radius(gear[0]), 0.1, 0.002, "tooth height");
  near(angle(gear[12]) - angle(gear[0]), 18, 0.1, "root width in degrees");
  near(angle(gear[8]) - angle(gear[4]), 10.8, 0.1, "top width in degrees");
  near(angle(gear[16]) - angle(gear[0]), 45, 0.1, "pitch in degrees");
  // The gap at the root is 45 - 18 = 27 degrees: one and a half times the root of a tooth.
  near((45 - 18) / 18, 1.5, 0.001, "a gap is half as wide again as a tooth");
  // One tooth is centred straight up, so there is one at each compass point.
  near((angle(gear[0]) + angle(gear[12])) / 2, 270, 0.1, "a tooth points straight up");
});

test("lightning bolt: 40% wide, 80% tall, tips and steps where the drills say, edges lean 36 / 9 / 32 / 18 degrees", () => {
  const [bolt] = parts("sym-lightning");
  const b = box(bolt);
  near(b.maxX - b.minX, 0.4, 0.002, "width");
  near(b.maxY - b.minY, 0.8, 0.002, "height");
  const v = [0, 10, 20, 30, 40, 50].map((i) => ({ x: bolt[i].x / S, y: bolt[i].y / S }));
  near(v[0].x, 0.55, 0.002, "top tip across");
  near(v[0].y, 0.1, 0.002, "top tip down");
  near(v[3].x, 0.35, 0.002, "bottom tip across");
  near(v[3].y, 0.9, 0.002, "bottom tip down");
  near(v[0].x - v[3].x, 0.2, 0.002, "bottom tip left of the top tip by half the bolt's width");
  near(v[1].y, 0.5, 0.002, "left step height");
  near(v[4].y, 0.42, 0.002, "right step height");
  near(v[2].x - v[1].x, 0.18, 0.002, "left step length");
  near(v[4].x - v[5].x, 0.2, 0.002, "right step length");
  const lean = (a: P, c: P) => deg(Math.atan2(Math.abs(c.x - a.x), Math.abs(c.y - a.y)));
  near(lean(v[3], v[4]), 36, 0.6, "long lower edge");
  near(lean(v[5], v[0]), 9, 0.6, "upper right edge");
  near(lean(v[0], v[1]), 32, 0.6, "upper left edge");
  near(lean(v[2], v[3]), 18, 0.6, "lower left edge");
});

test("heart: 61% wide, 55% tall, dip 45% down, point 88% down, lobes 14% to the side and 13% above the dip", () => {
  const [heart] = parts("sym-heart");
  const b = box(heart);
  near(b.maxX - b.minX, 0.61, 0.005, "width");
  near(b.maxY - b.minY, 0.55, 0.005, "height");
  near(heart[0].y / S, 0.45, 0.005, "dip");
  near(b.maxY, 0.88, 0.006, "point (87.5%, stated as about 88%)");
  const leftHalf = heart.filter((p) => p.x < S / 2);
  const lobeTop = leftHalf.reduce((best, p) => (p.y < best.y ? p : best), leftHalf[0]);
  near(0.5 - lobeTop.x / S, 0.14, 0.005, "lobe peak off the centre line");
  near(heart[0].y / S - lobeTop.y / S, 0.13, 0.005, "lobe peak above the dip");
  const widest = heart.reduce((best, p) => (p.x > best.x ? p : best), heart[0]);
  near(widest.y / S, heart[0].y / S, 0.03, "widest almost level with the dip");
});

test("dog: eyes 43% down the head and a third of its width apart, nose 64% down, ears straddle the outline", () => {
  const [head, leftEar, , leftEye, rightEye, nose, , mouth] = parts("ani-dog");
  const h = box(head);
  const headW = h.maxX - h.minX;
  const headH = h.maxY - h.minY;
  near(headW / headH, 1, 0.05, "head about as wide as it is tall");
  const eyeY = (box(leftEye).minY + box(leftEye).maxY) / 2;
  near((eyeY - h.minY) / headH, 0.43, 0.01, "eyes down the head");
  const eyeGap = (box(rightEye).minX + box(rightEye).maxX) / 2 - (box(leftEye).minX + box(leftEye).maxX) / 2;
  near(eyeGap / headW, 0.35, 0.02, "eye gap over head width");
  const noseY = (box(nose).minY + box(nose).maxY) / 2;
  near((noseY - h.minY) / headH, 0.64, 0.01, "nose down the head");
  const m = box(mouth);
  near((m.maxX - m.minX) / headW, 0.25, 0.02, "mouth width over head width");
  const e = box(leftEar);
  near((e.maxY - e.minY) / headH, 0.6, 0.02, "ear height over head height");
  near((e.maxY - h.minY) / headH, 0.7, 0.02, "ear hangs to about 70% of the way down");
  assert.ok(e.minX < h.minX && e.maxX > h.minX, "the ear straddles the head's outline");
  near((e.maxX - h.minX) / (e.maxX - e.minX), 0.5, 0.05, "about half the ear is inside the head");
});

test("cat: whiskers a third of the head wide, ending a tenth outside it, angled up 12 and down 6 degrees, ear tips a fifth up", () => {
  const [head, , , , , upperLeft, lowerLeft] = parts("ani-cat");
  const h = box(head);
  const headW = h.maxX - h.minX;
  const headH = h.maxY - h.minY;
  const upper = box(upperLeft);
  const lower = box(lowerLeft);
  near((upper.maxX - upper.minX) / headW, 0.33, 0.03, "whisker length over head width");
  near((h.minX - upper.minX) / headW, 0.1, 0.02, "whisker tip outside the outline");
  near(deg(Math.atan2(upper.maxY - upper.minY, upper.maxX - upper.minX)), 12, 1, "upper whisker angle");
  near(deg(Math.atan2(lower.maxY - lower.minY, lower.maxX - lower.minX)), 6, 1, "lower whisker angle");
  // The crown notch is the keypoint at (0.5, 0.18); the ear tips are the top of the outline (0.06).
  near((0.18 - h.minY) / headH, 0.2, 0.02, "ear tips above the notch, over the head's height");
  near(0.72 - 0.28, 0.44, 0.0001, "ear tips apart");
  near(0.44 / headW, 0.75, 0.04, "ear tips apart over head width");
});

// ------------------------------------------------------------ scored claims ---

test("the comparisons the copy makes between scored rows hold", () => {
  const dog = example("/draw-a-dog-from-memory");
  const [dogHead, dogEars, dogEyes, dogMuzzle] = dog.partShares;
  assert.ok(dogEars.percent >= dogHead.percent * 0.8, "dog: the ears carry nearly as many points as the head");
  assert.ok(dogEyes.percent < dogEars.percent && dogMuzzle.percent < dogEars.percent, "dog: eyes and muzzle are the smaller parts");
  const dogCost = (i: number) => dog.rows[0].total - dog.rows[i].total;
  assert.ok(dogCost(3) > dogCost(2), "dog: a missing mouth costs more than moving the whole muzzle");
  assert.ok(dogCost(1) > dogCost(2), "dog: the ears cost more than the muzzle");

  const cat = example("/draw-a-cat-from-memory");
  const [, catEyes, catNoseMouth, catWhiskers] = cat.partShares;
  assert.ok(catWhiskers.percent >= catEyes.percent * 1.8, "cat: the whiskers carry about twice what the eyes do");
  assert.ok(catWhiskers.percent > catNoseMouth.percent, "cat: the whiskers carry more than the nose and mouth");

  const triangle = example("/draw-a-triangle-from-memory");
  assert.ok(triangle.partShares.every((part) => Math.abs(part.percent - 33) <= 1), "triangle: the three sides carry a third each");
  assert.ok(triangle.rows[3].scale < triangle.rows[0].scale - 5, "triangle: drawn too tall, the scale score falls");

  const bolt = example("/draw-a-lightning-bolt-from-memory");
  const [upper, steps, lower] = bolt.partShares;
  assert.ok(lower.percent > upper.percent && upper.percent > steps.percent, "bolt: lower arm > upper arm > steps");
  const boltCost = (i: number) => bolt.rows[0].total - bolt.rows[i].total;
  assert.ok(boltCost(2) * 2 < boltCost(1) && boltCost(3) * 2 < boltCost(1), "bolt: each detail costs less than half of what the tip does");

  const gear = example("/draw-a-gear-from-memory");
  const [tops, sides, gaps] = gear.partShares;
  assert.ok(tops.percent < gaps.percent && gaps.percent < sides.percent, "gear: tops < gaps < sides");
  const gearCost = (i: number) => gear.rows[0].total - gear.rows[i].total;
  assert.ok(gearCost(3) < 5, "gear: rounding the teeth barely matters");
  assert.ok(gearCost(1) > gearCost(2) && gearCost(1) > gearCost(3), "gear: the wrong tooth count is the costliest");
  assert.ok(gear.rows[1].coverage < gear.rows[0].coverage - 5, "gear: six teeth is visibly less line");

  const star = example("/draw-a-perfect-star");
  assert.deepEqual(star.partShares.map((part) => part.percent), [20, 40, 40], "star: a fifth of the line per arm");
  assert.ok(star.rows[2].coverage < star.rows[0].coverage - 5, "star: the fatter outline holds more line than the target");

  const heart = example("/draw-a-perfect-heart");
  assert.ok(heart.partShares[1].percent > heart.partShares[0].percent, "heart: the slopes are a little more of the line than the lobes");
  assert.ok(heart.rows[1].scale < heart.rows[0].scale, "heart: a narrower lobe is a smaller heart");
  assert.ok(heart.rows[0].total - heart.rows[1].total > heart.rows[0].total - heart.rows[2].total, "heart: the narrow lobe costs more than the wandering point");
});
