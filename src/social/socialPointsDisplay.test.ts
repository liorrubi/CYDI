import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  clearSocialPointsOverride,
  getSocialPointsOverride,
  setSocialPointsOverride,
  subscribeSocialPointsOverride,
} from "./socialPointsDisplay";
import { rankFor } from "./socialRank";

beforeEach(() => clearSocialPointsOverride());

test("with no hold in place the badge falls through to the stored total", () => {
  assert.equal(getSocialPointsOverride(), null);
});

test("a hold pins the displayed value and releasing it hands control back", () => {
  setSocialPointsOverride(8);
  assert.equal(getSocialPointsOverride(), 8);
  setSocialPointsOverride(null);
  assert.equal(getSocialPointsOverride(), null);
});

test("subscribers are told, and only when the value actually changes", () => {
  const seen: (number | null)[] = [];
  const stop = subscribeSocialPointsOverride((v) => seen.push(v));
  setSocialPointsOverride(8);
  setSocialPointsOverride(8); // no change, no notification
  setSocialPointsOverride(9);
  setSocialPointsOverride(null);
  stop();
  setSocialPointsOverride(5);
  assert.deepEqual(seen, [8, 9, null]);
});

test("the badge cannot reveal a promotion before the card counts up to it", () => {
  // The award is banked the instant the match is scored, so the store already
  // says 10. The badge must keep showing Rookie 8 until the card gets there.
  const storedTotal = 10;
  setSocialPointsOverride(8);
  const shown = getSocialPointsOverride() ?? storedTotal;
  assert.equal(shown, 8);
  assert.equal(rankFor(shown).name, "Rookie", "no early promotion");

  // Mid-count: still the old rank.
  setSocialPointsOverride(9);
  assert.equal(rankFor(getSocialPointsOverride()!).name, "Rookie");

  // The moment the count reaches the threshold, badge and card promote together.
  setSocialPointsOverride(10);
  assert.equal(rankFor(getSocialPointsOverride()!).name, "Challenger");

  // Released: the badge now reads the store, which agrees.
  setSocialPointsOverride(null);
  assert.equal(getSocialPointsOverride() ?? storedTotal, 10);
});

test("a hold is never left behind when a card unmounts mid-count", () => {
  setSocialPointsOverride(9);
  clearSocialPointsOverride();
  assert.equal(getSocialPointsOverride(), null, "the badge must not be stranded on a half-counted number");
});

test("a negative or fractional hold is normalised rather than shown raw", () => {
  setSocialPointsOverride(-4);
  assert.equal(getSocialPointsOverride(), 0);
  setSocialPointsOverride(8.7);
  assert.equal(getSocialPointsOverride(), 8);
});
