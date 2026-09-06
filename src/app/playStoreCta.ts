/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Web -> Google Play install funnel. Two things every Play Store CTA call site
// shares, kept here as plain functions (no React, no Capacitor) so both can be
// unit-tested without a DOM:
//
//   1. WHICH surface a click/impression came from. The Classic result screen is
//      one component, but it is also the result screen an SEO landing page's
//      practice round lands on (seo/landingPages.ts -> App.tsx's
//      startLandingPractice), and landing paths are never rewritten by in-app
//      navigation - so `location.pathname` is what tells the two apart.
//
//   2. The one-impression-per-appearance rule. `play_store_cta_shown` is the
//      denominator of the CTR we want to read per surface, so a React rerender,
//      a StrictMode double-invoked effect or a remount must never inflate it.
//
// Deliberately NOT the place for the listing URL: that lives in
// services/nativeShare.ts, which is the single source every client call site
// imports from.
import type { PlayStoreSurfaceParam } from "../services/analyticsSchema";

/**
 * The SEO landing paths that put their own shape on the Classic result screen.
 * Keys are the canonical paths from seo/landingPages.ts - playStoreCta.test.ts
 * asserts every one of them is still a real landing path, so a renamed page
 * cannot silently start reporting as a plain result.
 *
 * The two mode pages (/multiplayer-drawing-game,
 * /2-player-drawing-game-one-phone) are absent on purpose: they open Play
 * Together / 2 Players, neither of which renders this CTA, so a surface id for
 * them could never be emitted. /draw-shapes-online and /drawing-accuracy-test
 * are absent for the same reason as each other - they land on the category map
 * or on the circle with no page-specific promise to attribute.
 */
const SEO_RESULT_SURFACES: Record<string, PlayStoreSurfaceParam> = {
  "/draw-a-perfect-circle": "seo_circle",
  "/draw-a-perfect-star": "seo_star",
  "/draw-a-perfect-heart": "seo_heart",
};

/**
 * The surface id for a CTA on the Classic result screen at `pathname`.
 *
 * Anything that is not one of the three shape landing pages is a plain Classic
 * web result - including "/play/classic", "/" and any path added later, which
 * fall back to "results" rather than to a guess.
 *
 * Trailing slashes are stripped the same way landingPageForPath strips them, so
 * "/draw-a-perfect-star/" resolves identically to the Worker's own resolution.
 */
export function resultSurfaceForPath(pathname: string): PlayStoreSurfaceParam {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return SEO_RESULT_SURFACES[normalized] ?? "results";
}

/** Everything the Classic result screen knows that bears on whether the install CTA belongs on screen. */
export type PlayStoreCtaConditions = {
  /** Inside the Android app. The app never advertises the listing it was installed from. */
  isNative: boolean;
  /** The round is resolved and the result screen is up. */
  atResult: boolean;
  /** A landing page's one-off practice round - see seo/landingPages.ts. */
  practice: boolean;
  /** The result-actions coach mark is on screen. */
  resultTutorialVisible: boolean;
  /** The Create Challenge discovery prompt is on screen. */
  createDiscoveryVisible: boolean;
  /** A ×2 coins offer is still unresolved. */
  doubleOfferPending: boolean;
};

/**
 * "One message at a time", stated once so both the rule and its one exception
 * are testable. Teaching how to continue at all, and a live ×2 decision, both
 * outrank an install nudge; so does the create-discovery prompt, because two
 * nudges stacked in the same slot is the aggressive version of this.
 *
 * THE EXCEPTION - the coach mark does not block a practice round. It is keyed on
 * `completedRounds === 0` (tutorialStore.shouldShowFirstRoundCoach) and a
 * practice round deliberately persists nothing, so on /draw-a-perfect-star and
 * /draw-a-perfect-heart - where every round is a practice round - the coach never
 * retires. Gating on it there would not delay the CTA, it would remove it
 * permanently, and the two seo_* surfaces could never record a single impression
 * or click. Verified in the browser before this exception existed: two
 * consecutive practice results on /draw-a-perfect-star both still showed
 * "Tap Try Again for another go" and neither showed the CTA.
 *
 * Nothing here is persisted: a CTA held back by any of these simply returns on
 * the next result.
 */
export function shouldShowPlayStoreCta(conditions: PlayStoreCtaConditions): boolean {
  if (conditions.isNative || !conditions.atResult) return false;
  if (conditions.doubleOfferPending || conditions.createDiscoveryVisible) return false;
  if (conditions.resultTutorialVisible && !conditions.practice) return false;
  return true;
}

/**
 * What a call site remembers between renders. `shownSurface` is the surface an
 * impression was already counted for while the CTA has been continuously on
 * screen - null whenever it is not on screen, which is what re-arms the next
 * genuine appearance.
 */
export type CtaImpressionState = { shownSurface: PlayStoreSurfaceParam | null };

export function initialCtaImpressionState(): CtaImpressionState {
  return { shownSurface: null };
}

/**
 * One step of the impression rule. Call it with whether the CTA is on screen
 * right now and which surface it is on; `emit` is the surface to send
 * `play_store_cta_shown` for, or null to send nothing.
 *
 * Counts exactly one impression per genuine appearance:
 *   - hidden -> shown            emits
 *   - shown  -> shown (rerender) does not emit, however many times it repeats
 *   - shown  -> hidden -> shown  emits again (a second, real appearance)
 *   - surface changes while shown emits, because that is a different CTA
 *
 * Being a pure function of the previous state (rather than an effect keyed on a
 * dependency) is what makes it survive a StrictMode double-invoke and a
 * remount-with-preserved-ref alike - and what makes the rule testable without
 * rendering anything.
 */
export function ctaImpressionStep(
  state: CtaImpressionState,
  visible: boolean,
  surface: PlayStoreSurfaceParam,
): { state: CtaImpressionState; emit: PlayStoreSurfaceParam | null } {
  if (!visible) return { state: { shownSurface: null }, emit: null };
  if (state.shownSurface === surface) return { state, emit: null };
  return { state: { shownSurface: surface }, emit: surface };
}
