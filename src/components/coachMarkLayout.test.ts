import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

// A real user reported the pencil "jumping" at the start of a stroke in
// 2 Players. The cause was layout, not pointer handling: the drawing hint sat
// ABOVE the canvas until the first point landed, then re-rendered BELOW the
// buttons as a different element. That pulled the canvas 62px up mid-stroke -
// measured - so the finger stayed still while the canvas slid out from under
// it, and everything drawn after that was offset.
//
// The rule that prevents it: while someone can be drawing, exactly one coach
// mark exists and it never changes position. Only its text may change.

const FILES = [
  join(import.meta.dirname, "passplay", "PassPlayGame.tsx"),
  join(import.meta.dirname, "multiplayer", "PlayTogetherRoom.tsx"),
];

/** The JSX of the SHOW_SHAPE/DRAWING branch - everything rendered around the canvas while it is live. */
function drawingBranch(source: string): string {
  const start = source.indexOf('phase === "SHOW_SHAPE" || phase === "DRAWING"');
  assert.ok(start > 0, "could not find the drawing branch");
  const end = source.indexOf('phase === "ROUND_RESULTS"', start);
  return source.slice(start, end > 0 ? end : undefined);
}

test("the drawing phase renders its hint from a single place", async () => {
  for (const file of FILES) {
    const branch = drawingBranch(await readFile(file, "utf8"));
    // One for SHOW_SHAPE ("remember this"), one for DRAWING. A third means the
    // hint is being rendered in two positions again.
    const marks = branch.match(/<RoundCoachMark/g) ?? [];
    assert.ok(marks.length <= 2, `${basename(file)} renders ${marks.length} coach marks around the canvas`);
  }
});

test("no coach mark is gated on whether the player has started drawing", async () => {
  // `hasDrawn` flips on the first two points - mid-stroke. Mounting or
  // unmounting anything on that signal reflows the canvas under a live finger.
  // Switching its TEXT on it is fine, which is why the check is for a mounting
  // condition rather than any mention of hasDrawn.
  for (const file of FILES) {
    const branch = drawingBranch(await readFile(file, "utf8"));
    for (const pattern of [/hasDrawn\s*&&\s*<RoundCoachMark/, /!hasDrawn\s*&&\s*<RoundCoachMark/, /hasDrawn\s*&&\s*\(\s*<RoundCoachMark/]) {
      assert.ok(!pattern.test(branch), `${basename(file)} mounts a coach mark on hasDrawn (${pattern})`);
    }
  }
});

test("the coach slot reserves its height, so a longer hint cannot move the canvas either", async () => {
  const css = await readFile(join(import.meta.dirname, "..", "styles", "global.css"), "utf8");
  const rule = css.slice(css.lastIndexOf(".mp-coach {"));
  assert.ok(/min-height/.test(rule.slice(0, 200)), ".mp-coach must reserve a height");
});
