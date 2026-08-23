import assert from "node:assert/strict";
import test from "node:test";
import {
  compactRankLabel,
  crossedRanks,
  MAX_RANK,
  rankFor,
  rankProgress,
  RANK_TWEEN_BASE_MS,
  RANK_TWEEN_MAX_MS,
  shouldAnimateAward,
  SOCIAL_RANKS,
  tweenDurationMs,
} from "./socialRank";

// ------------------------------------------------------------- thresholds ---

test("the ladder is the agreed six ranks, in ascending order", () => {
  assert.deepEqual(
    SOCIAL_RANKS.map((r) => [r.name, r.threshold]),
    [
      ["Rookie", 0],
      ["Challenger", 10],
      ["Competitor", 25],
      ["Social Artist", 50],
      ["Champion", 100],
      ["CYDI Master", 200],
    ],
  );
  for (let i = 1; i < SOCIAL_RANKS.length; i++) {
    assert.ok(SOCIAL_RANKS[i].threshold > SOCIAL_RANKS[i - 1].threshold, "thresholds must strictly increase");
  }
});

test("rank is correct on both sides of every boundary", () => {
  const cases: [number, string][] = [
    [0, "Rookie"],
    [9, "Rookie"],
    [10, "Challenger"],
    [24, "Challenger"],
    [25, "Competitor"],
    [49, "Competitor"],
    [50, "Social Artist"],
    [99, "Social Artist"],
    [100, "Champion"],
    [199, "Champion"],
    [200, "CYDI Master"],
    [201, "CYDI Master"],
    [10_000, "CYDI Master"],
  ];
  for (const [points, name] of cases) {
    assert.equal(rankFor(points).name, name, `${points} points`);
  }
});

test("a nonsense total is treated as zero rather than crashing the card", () => {
  assert.equal(rankFor(-5).name, "Rookie");
  assert.equal(rankFor(Number.NaN).name, "Rookie");
  assert.equal(rankProgress(-5).points, 0);
});

// --------------------------------------------------------------- progress ---

test("points to the next rank count down correctly", () => {
  assert.equal(rankProgress(0).pointsToNext, 10);
  assert.equal(rankProgress(9).pointsToNext, 1);
  assert.equal(rankProgress(10).pointsToNext, 15);
  assert.equal(rankProgress(37).pointsToNext, 13, "the worked example from the brief");
  assert.equal(rankProgress(99).pointsToNext, 1);
  assert.equal(rankProgress(199).pointsToNext, 1);
});

test("the fraction runs 0 to 1 across each band", () => {
  assert.equal(rankProgress(0).fraction, 0, "start of Rookie");
  assert.equal(rankProgress(5).fraction, 0.5, "halfway through Rookie");
  assert.equal(rankProgress(10).fraction, 0, "start of Challenger resets the bar");
  assert.equal(rankProgress(25).fraction, 0);
  assert.equal(rankProgress(37).fraction, 12 / 25);
  assert.equal(rankProgress(75).fraction, 0.5, "halfway through Social Artist");
  assert.equal(rankProgress(150).fraction, 0.5, "halfway through Champion");
  for (const points of [0, 9, 10, 24, 25, 49, 50, 99, 100, 199, 200, 500]) {
    const f = rankProgress(points).fraction;
    assert.ok(f >= 0 && f <= 1, `${points} produced a fraction of ${f}`);
  }
});

test("the worked example from the brief renders as specified", () => {
  const p = rankProgress(37);
  assert.equal(p.rank.name, "Competitor");
  assert.equal(p.label, "37 / 50");
  assert.equal(p.next?.name, "Social Artist");
  assert.equal(p.pointsToNext, 13);
});

test("the label always states progress in numbers, so colour is never the only signal", () => {
  assert.equal(rankProgress(0).label, "0 / 10");
  assert.equal(rankProgress(99).label, "99 / 100");
  assert.equal(rankProgress(240).label, "240", "no target left to state at the top");
});

// -------------------------------------------------------------- max rank ----

test("the top rank shows as reached and complete, not as empty progress", () => {
  const p = rankProgress(200);
  assert.equal(p.isMax, true);
  assert.equal(p.rank.name, "CYDI Master");
  assert.equal(p.next, null);
  assert.equal(p.pointsToNext, 0);
  assert.equal(p.fraction, 1, "a full bar reads as 'ladder complete'");
  assert.equal(MAX_RANK.name, "CYDI Master");
});

test("points keep accumulating past the top rank without inventing new ones", () => {
  assert.equal(rankProgress(500).points, 500);
  assert.equal(rankProgress(500).rank.name, "CYDI Master");
  assert.equal(rankProgress(500).isMax, true);
  assert.deepEqual(crossedRanks(200, 500), [], "no promotion exists above the top");
});

// -------------------------------------------------------------- rank up -----

test("a promotion is detected only when a threshold is actually crossed", () => {
  assert.deepEqual(crossedRanks(7, 10).map((r) => r.name), ["Challenger"]);
  assert.deepEqual(crossedRanks(7, 9), [], "still short");
  assert.deepEqual(crossedRanks(10, 12), [], "already there");
  assert.deepEqual(crossedRanks(24, 25).map((r) => r.name), ["Competitor"]);
});

test("an award that clears more than one threshold reports every rank passed", () => {
  assert.deepEqual(crossedRanks(8, 26).map((r) => r.name), ["Challenger", "Competitor"]);
  assert.deepEqual(crossedRanks(0, 200).map((r) => r.name), [
    "Challenger",
    "Competitor",
    "Social Artist",
    "Champion",
    "CYDI Master",
  ]);
});

test("a repeat of a finished match animates nothing and promotes nothing", () => {
  // The store returns 0 points for an award it has already paid - a reconnect,
  // a remount, a repeated final snapshot. That 0 is the signal to stay still.
  assert.equal(shouldAnimateAward(0), false);
  assert.equal(shouldAnimateAward(3), true);
  // And with previousTotal === total there is nothing to cross either way.
  assert.deepEqual(crossedRanks(12, 12), []);
});

test("the animation runs from the pre-match total to the new one", () => {
  // A won match at 8 points: 8 -> 11, which is a promotion to Challenger.
  const from = 8;
  const to = from + 3;
  assert.equal(rankProgress(from).rank.name, "Rookie");
  assert.equal(rankProgress(to).rank.name, "Challenger");
  assert.deepEqual(crossedRanks(from, to).map((r) => r.name), ["Challenger"]);
  // The bar starts nearly full in the old band and restarts low in the new one.
  assert.equal(rankProgress(from).fraction, 0.8);
  assert.equal(rankProgress(to).fraction, 1 / 15);
});

test("a completed rematch can progress the bar again from where it left off", () => {
  let total = 0;
  total += 3; // first match won
  assert.equal(rankProgress(total).points, 3);
  total += 3; // rematch won
  assert.equal(rankProgress(total).points, 6);
  assert.deepEqual(crossedRanks(3, 6), [], "not there yet");
  total += 3; // a third completed match
  assert.equal(total, 9);
  assert.deepEqual(crossedRanks(6, total), [], "still one short of Challenger");
  const before = total;
  total += 3; // the fourth tips it over
  assert.deepEqual(crossedRanks(before, total).map((r) => r.name), ["Challenger"]);
});

// ------------------------------------------------------- reduced motion -----

test("reduced motion drops the animation entirely rather than shortening it", () => {
  assert.equal(tweenDurationMs(0, true), 0);
  assert.equal(tweenDurationMs(3, true), 0);
});

test("the animation stays short, and is capped however many ranks are crossed", () => {
  assert.equal(tweenDurationMs(0, false), RANK_TWEEN_BASE_MS);
  assert.ok(tweenDurationMs(1, false) > tweenDurationMs(0, false), "a promotion earns a little more room");
  assert.equal(tweenDurationMs(5, false), RANK_TWEEN_MAX_MS);
  assert.ok(RANK_TWEEN_MAX_MS <= 2000, "nobody should be kept from Rematch for longer than this");
});

// -------------------------------------------------------------- compact -----

test("the compact indicator names the rank alongside the total", () => {
  assert.equal(compactRankLabel(18), "🎖️ Challenger · 18");
  assert.equal(compactRankLabel(0), "🎖️ Rookie · 0");
  assert.equal(compactRankLabel(240), "🎖️ CYDI Master · 240");
});

// ------------------------------------------------------------ persistence ---

test("rank is derived, so nothing new has to be stored or migrated", async () => {
  // The whole point of deriving: an existing record with only a total is a
  // complete, correctly-ranked profile with no migration step.
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/socialPointsStore.ts", import.meta.url), "utf8"),
  );
  // Comments stripped: the store's forward-room note mentions rank precisely
  // because it does not store one.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\brank\b/i.test(code), "the store must not persist a rank");
  assert.ok(code.includes('"cydi.social.v1"'), "and the existing key is unchanged");
});
