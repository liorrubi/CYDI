/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The game's own web addresses. Plain constants with no imports, so the Worker can
// read them too: worker/notFound.ts builds its list of real app routes from these,
// and a path App.tsx serves can never be answered with a 404 by the Worker.

/**
 * Where the web serves the GAME. "/" is the public site (art direction 3a); the
 * game's own home screen lives here, so it is a real, shareable address rather
 * than a mode of "/". Android never sees either: Capacitor loads index.html
 * from inside the APK at "/", and `Capacitor.isNativePlatform()` gates every branch in App.tsx.
 */
export const PLAY_PATH = "/play";

/**
 * Classic gameplay, entered straight from the site's primary CTA. It gets its
 * own address rather than sharing /play so a reload, a Back press and a shared
 * link all land where the button said they would. /play stays what it was: the
 * game's menu screen, and still the only route to Daily Challenge, Create
 * Challenge, My Challenges and the Shop.
 */
export const CLASSIC_PATH = "/play/classic";

/**
 * The bare Play Together join page. The lobby's room-code card tells guests to
 * "Enter it at playcydi.com/join", so this address must open the join form rather
 * than 404 - invite links (/join/<CODE>) are a separate route and arrive with the
 * code already filled in. A utility screen, not a landing page: the Worker serves
 * it with noindex so it never competes with "/".
 */
export const JOIN_PATH = "/join";

/** True for exactly /join (a trailing slash is tolerated) - never for /join/<anything>. */
export function isJoinPagePath(pathname: string): boolean {
  return (pathname.replace(/\/+$/, "") || "/") === JOIN_PATH;
}
