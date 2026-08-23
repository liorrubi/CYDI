/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Web-only: maps an SEO landing path to where in the game that page should open.
// The visible copy and metadata for these paths are NOT here - the Worker injects
// them server-side (worker/seoPages.ts), and landingPages.test.ts asserts the two
// path lists stay identical.
//
// Android reaches none of this: Capacitor loads index.html from the APK at path
// "/", which is not a landing path, so `landingPageForPath` returns undefined and
// App gets `landing={undefined}` - byte-identical behaviour to before.
//
// `shape` names a destination only. It grants nothing: ShapeChallengeScreen
// re-checks the player's real category/shape unlock state before honouring it and
// falls back to the map otherwise, so a landing page can never bypass unlocks,
// coins or progression.

import type { CategoryId } from "../content/contentRepository";

export type LandingPage = {
  path: string;
  /**
   * Which mode the page opens. Omitted means Shape Challenge, which is what
   * every shape-focused landing page wants. The two social pages would be
   * actively misleading without this: someone arriving from a page about
   * playing with friends should land in that mode, not on the shape map.
   */
  mode?: "playTogether" | "passPlay";
  /** Shape to open directly. Omitted = land on the Shape Challenge category map. */
  shape?: {
    category: CategoryId;
    shapeId: string;
    /**
     * A one-off practice round for a shape the player has not reached yet. Set
     * only where the page promises that specific shape and the normal unlock
     * order would otherwise drop the visitor on the category map instead.
     *
     * It grants nothing and costs nothing: the round is played, scored and shown
     * for real, but it persists NOTHING - no best score, no coins, no
     * completion, no category unlock, no round counters, no achievement input
     * (see app/shapeRoundOutcome.ts, which is the single place a finished round
     * writes anything).
     */
    practice?: true;
  };
};

// "circle" is the first shape of the first category, so it is unlocked for a
// brand-new player (frontier) and stays unlocked afterwards (completed) - the one
// deep link that needs no unlock exception.
const CIRCLE = { category: "geometric" as CategoryId, shapeId: "circle" };

// The five-point star sits deep in the geometric category and the heart is the
// first shape of a category that costs coins, so neither is reachable for a new
// visitor - both need the practice exception above to honour what the page says.
const STAR = { category: "geometric" as CategoryId, shapeId: "star-5", practice: true as const };
const HEART = { category: "symbols" as CategoryId, shapeId: "sym-heart", practice: true as const };

const LANDING_PAGES: LandingPage[] = [
  { path: "/drawing-accuracy-test", shape: CIRCLE },
  { path: "/draw-a-perfect-circle", shape: CIRCLE },
  { path: "/draw-a-perfect-star", shape: STAR },
  { path: "/draw-a-perfect-heart", shape: HEART },
  { path: "/draw-shapes-online" },
  { path: "/multiplayer-drawing-game", mode: "playTogether" },
  { path: "/2-player-drawing-game-one-phone", mode: "passPlay" },
];

export const LANDING_PATHS: string[] = LANDING_PAGES.map((page) => page.path);

/** Trailing slashes are stripped so "/draw-shapes-online/" resolves the same way the Worker resolves it. */
export function landingPageForPath(pathname: string): LandingPage | undefined {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return LANDING_PAGES.find((page) => page.path === normalized);
}
