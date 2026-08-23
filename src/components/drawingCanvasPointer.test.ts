import assert from "node:assert/strict";
import test from "node:test";
import { canStartStroke } from "./drawingCanvasPointer";

// The canvas going deaf while still looking live was reported from real
// multiplayer use. The only code that can swallow a touch on an enabled canvas
// is the "is another pointer already down" guard, and the id it checks is
// cleared exclusively by a matching pointerup/leave/cancel - so a single
// undelivered release used to disable drawing for good.

test("a free canvas accepts a new stroke", () => {
  assert.equal(canStartStroke(null, () => true), true);
});

test("a second finger is still ignored while the first is genuinely down", () => {
  // Capture confirms the recorded pointer is a real finger on the glass.
  assert.equal(canStartStroke(7, (id) => id === 7), false);
});

test("a recorded pointer that no longer holds capture is a ghost, and the new touch takes over", () => {
  // This is the reported bug: the release never arrived, so the id was never
  // cleared. Before the fix every later touch was dropped for the lifetime of
  // the canvas.
  assert.equal(canStartStroke(7, () => false), true);
});

test("capture is only ever asked about the recorded pointer", () => {
  const asked: number[] = [];
  canStartStroke(42, (id) => { asked.push(id); return false; });
  assert.deepEqual(asked, [42]);
});

test("an environment that cannot answer about capture never wedges the canvas", () => {
  // hasPointerCapture is missing in jsdom and some older WebViews; the caller
  // maps that to "not captured", which must mean drawable.
  assert.equal(canStartStroke(3, () => false), true);
});
