import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  clearSocialPointsOverride,
  getSocialPointsOverride,
  setSocialPointsOverride,
  subscribeSocialPointsOverride,
} from "./socialPointsDisplay";
import { rankFor, rankProgress } from "./socialRank";

beforeEach(() => clearSocialPointsOverride());

test("with no hold in place the badge falls through to the stored total", () => {
  assert.equal(getSocialPointsOverride(), null);
});

test("a hold pins the displayed value and releasing it hands control back", () => {
  setSocialPointsOverride(8);
  assert.equal(getSocialPointsOverride()?.points, 8);
  setSocialPointsOverride(null);
  assert.equal(getSocialPointsOverride(), null);
});

test("subscribers are told, and only when the value actually changes", () => {
  const seen: (number | null)[] = [];
  const stop = subscribeSocialPointsOverride((v) => seen.push(v === null ? null : v.points));
  setSocialPointsOverride(8);
  setSocialPointsOverride(8); // no change, no notification
  setSocialPointsOverride(9);
  setSocialPointsOverride(null);
  stop();
  setSocialPointsOverride(5);
  assert.deepEqual(seen, [8, 9, null]);
});

test("a hold carries the band the card is drawing, not the one the points imply", () => {
  // Mid-promotion: 10 points, but the bar is still completing the Rookie band.
  // The badge must read Rookie until the card flips, or it gives the game away.
  setSocialPointsOverride(10, 0);
  const held = getSocialPointsOverride()!;
  assert.equal(held.points, 10);
  assert.equal(rankProgress(held.points, held.bandIndex ?? undefined).rank.name, "Rookie");

  // And the instant the card flips, both move together.
  setSocialPointsOverride(10, 1);
  const flipped = getSocialPointsOverride()!;
  assert.equal(rankProgress(flipped.points, flipped.bandIndex ?? undefined).rank.name, "Challenger");
});

test("changing only the band still notifies, because the rank on screen changed", () => {
  const seen: (number | null)[] = [];
  const stop = subscribeSocialPointsOverride((v) => seen.push(v === null ? null : v.bandIndex));
  setSocialPointsOverride(10, 0);
  setSocialPointsOverride(10, 0); // identical, no notification
  setSocialPointsOverride(10, 1); // same points, new band - must notify
  stop();
  assert.deepEqual(seen, [0, 1]);
});

test("the badge cannot reveal a promotion before the card counts up to it", () => {
  // The award is banked the instant the match is scored, so the store already
  // says 10. The badge must keep showing Rookie 8 until the card gets there.
  const storedTotal = 10;
  setSocialPointsOverride(8, 0);
  assert.equal(getSocialPointsOverride()!.points, 8);
  assert.equal(rankFor(getSocialPointsOverride()!.points).name, "Rookie", "no early promotion");

  // Mid-count: still the old rank.
  setSocialPointsOverride(9, 0);
  assert.equal(rankFor(getSocialPointsOverride()!.points).name, "Rookie");

  // Released: the badge now reads the store, which agrees.
  setSocialPointsOverride(null);
  assert.equal(getSocialPointsOverride()?.points ?? storedTotal, 10);
});

test("a hold is never left behind when a card unmounts mid-count", () => {
  setSocialPointsOverride(9, 0);
  clearSocialPointsOverride();
  assert.equal(getSocialPointsOverride(), null, "the badge must not be stranded on a half-counted number");
});

test("a negative or fractional hold is normalised rather than shown raw", () => {
  setSocialPointsOverride(-4);
  assert.equal(getSocialPointsOverride()!.points, 0);
  setSocialPointsOverride(8.7);
  assert.equal(getSocialPointsOverride()!.points, 8);
});
