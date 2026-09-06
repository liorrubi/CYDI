// The two rules the web -> Google Play install funnel rests on, tested without
// rendering anything: which surface a result screen attributes a CTA to, and the
// one-impression-per-appearance guarantee that keeps play_store_cta_shown a
// trustworthy CTR denominator.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ctaImpressionStep,
  initialCtaImpressionState,
  resultSurfaceForPath,
  shouldShowPlayStoreCta,
} from "./playStoreCta.ts";
import { PLAY_STORE_SURFACE_PARAMS } from "../services/analyticsSchema.ts";
import { LANDING_PATHS } from "../seo/landingPages.ts";

// --- pathname -> surface -----------------------------------------------------

test("the three shape landing paths map to their own surfaces", () => {
  assert.equal(resultSurfaceForPath("/draw-a-perfect-circle"), "seo_circle");
  assert.equal(resultSurfaceForPath("/draw-a-perfect-star"), "seo_star");
  assert.equal(resultSurfaceForPath("/draw-a-perfect-heart"), "seo_heart");
});

test("a trailing slash resolves the same way the Worker resolves it", () => {
  assert.equal(resultSurfaceForPath("/draw-a-perfect-star/"), "seo_star");
  assert.equal(resultSurfaceForPath("/draw-a-perfect-heart///"), "seo_heart");
});

test("every plain Classic web result falls back to 'results', never to a guess", () => {
  for (const path of ["/", "/play", "/play/classic", "/draw-shapes-online", "/drawing-accuracy-test", "/nonsense"]) {
    assert.equal(resultSurfaceForPath(path), "results", path);
  }
});

test("an empty pathname is treated as the site root, not as an unknown key", () => {
  assert.equal(resultSurfaceForPath(""), "results");
});

// The mapping keys are copies of landing paths, so a renamed page would otherwise
// silently start reporting as a plain result instead of failing loudly here.
test("each mapped SEO path is still a real landing path", () => {
  for (const path of ["/draw-a-perfect-circle", "/draw-a-perfect-star", "/draw-a-perfect-heart"]) {
    assert.ok(LANDING_PATHS.includes(path), `${path} is no longer a landing path`);
  }
});

test("every surface this module can produce is a valid schema surface", () => {
  const produced = [
    resultSurfaceForPath("/"),
    resultSurfaceForPath("/draw-a-perfect-circle"),
    resultSurfaceForPath("/draw-a-perfect-star"),
    resultSurfaceForPath("/draw-a-perfect-heart"),
  ];
  for (const surface of produced) {
    assert.ok((PLAY_STORE_SURFACE_PARAMS as readonly string[]).includes(surface), surface);
  }
});

// --- when the CTA is allowed on screen ---------------------------------------

/** A resolved plain Classic web result with nothing else competing for the slot. */
const CLEAR_RESULT = {
  isNative: false,
  atResult: true,
  practice: false,
  resultTutorialVisible: false,
  createDiscoveryVisible: false,
  doubleOfferPending: false,
};

test("a clear result screen shows the CTA", () => {
  assert.equal(shouldShowPlayStoreCta(CLEAR_RESULT), true);
});

test("nothing before the round is resolved", () => {
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, atResult: false }), false);
});

test("never inside the Android app, whatever else is true", () => {
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, isNative: true }), false);
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, isNative: true, practice: true }), false);
});

test("a live ×2 offer and the create-discovery prompt each hold it back", () => {
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, doubleOfferPending: true }), false);
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, createDiscoveryVisible: true }), false);
  // ...and they still do on a practice round: the exception below is about the
  // coach mark only, not a licence to stack the CTA on top of anything.
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, practice: true, doubleOfferPending: true }), false);
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, practice: true, createDiscoveryVisible: true }), false);
});

test("the coach mark holds it back on a real round, where the coach actually retires", () => {
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, resultTutorialVisible: true }), false);
  // The next result, once the coach is done, is where it appears.
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, resultTutorialVisible: false }), true);
});

// The regression this exception exists for: the first-round coach is keyed on
// completedRounds, a practice round never increments it, so on the star and heart
// landing pages the coach is permanent - and gating on it would have removed those
// two surfaces from the funnel entirely rather than merely delaying them.
test("the coach mark does NOT hold it back on a practice round, which the coach never leaves", () => {
  assert.equal(shouldShowPlayStoreCta({ ...CLEAR_RESULT, practice: true, resultTutorialVisible: true }), true);
});

// --- one impression per appearance ------------------------------------------

/** Drives the rule the way a component does: feed it a sequence of renders, collect what it emitted. */
function runRenders(renders: { visible: boolean; surface?: "results" | "seo_circle" | "seo_star" }[]): (string | null)[] {
  let state = initialCtaImpressionState();
  const emitted: (string | null)[] = [];
  for (const render of renders) {
    const step = ctaImpressionStep(state, render.visible, render.surface ?? "results");
    state = step.state;
    emitted.push(step.emit);
  }
  return emitted;
}

test("a hidden CTA emits nothing", () => {
  assert.deepEqual(runRenders([{ visible: false }, { visible: false }]), [null, null]);
});

test("the first genuine appearance emits exactly one impression", () => {
  assert.deepEqual(runRenders([{ visible: false }, { visible: true }]), [null, "results"]);
});

test("rerenders while the CTA stays on screen never emit again", () => {
  const emitted = runRenders([
    { visible: true },
    { visible: true },
    { visible: true },
    { visible: true },
    { visible: true },
  ]);
  assert.deepEqual(emitted, ["results", null, null, null, null]);
});

// StrictMode invokes an effect, cleans up, and invokes it again on the same mount.
// The ref survives that, so the second invocation must be a no-op - otherwise every
// impression would be double-counted in exactly the builds we test on.
test("a StrictMode-style double invocation counts one impression, not two", () => {
  let state = initialCtaImpressionState();
  const first = ctaImpressionStep(state, true, "results");
  state = first.state;
  const second = ctaImpressionStep(state, true, "results");
  assert.equal(first.emit, "results");
  assert.equal(second.emit, null);
});

test("hiding and showing again is a second real appearance and does emit", () => {
  const emitted = runRenders([
    { visible: true },
    { visible: true },
    { visible: false },
    { visible: true },
    { visible: true },
  ]);
  assert.deepEqual(emitted, ["results", null, null, "results", null]);
});

test("a surface change while visible emits, because it is a different CTA", () => {
  const emitted = runRenders([
    { visible: true, surface: "results" },
    { visible: true, surface: "seo_star" },
    { visible: true, surface: "seo_star" },
  ]);
  assert.deepEqual(emitted, ["results", "seo_star", null]);
});

test("the state is never mutated in place - a caller keeping the old one sees the old one", () => {
  const before = initialCtaImpressionState();
  const step = ctaImpressionStep(before, true, "seo_circle");
  assert.deepEqual(before, { shownSurface: null });
  assert.deepEqual(step.state, { shownSurface: "seo_circle" });
});
