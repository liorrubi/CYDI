/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The "Start a Game with Friends" / "Start a Two-Player Game" button at the
// bottom of a mode landing page.
//
// That button lives in the Worker-rendered copy block, outside React, so it can
// only ever be a plain <a href>. Pointing it at the app on its own page gets the
// browser to scroll up for free - but a scroll is all it is. A visitor who has
// since pressed Back is carried up to the HOME screen, which is the one
// destination the button does not promise. So the app listens for the fragment
// and puts itself back into the mode the page is about.
//
// Only from home: anywhere else the player went there deliberately, and a
// half-played match must not be thrown away by a button they scrolled past.
import type { LandingPage } from "./landingPages";

/** The CTA fragment. `root` is the app's mount node, so the browser scrolls to the top of the app on its own. */
export const LANDING_CTA_HASH = "#root";

/** The mode to open, or null to leave the app exactly as it is. */
export function landingCtaMode(
  landing: LandingPage | undefined,
  currentScreenName: string,
): NonNullable<LandingPage["mode"]> | null {
  if (!landing?.mode) return null;
  if (currentScreenName !== "home") return null;
  return landing.mode;
}
