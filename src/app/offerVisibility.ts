// 0.59.0: a Rewarded offer counts as shown the moment it is rendered (reward_offer_shown, after any streak card has
// closed - app/streakCardGate.ts). On a short phone its choices can still sit below the fold of a long result screen,
// so they are brought into view once, by as little as needed. Layout only: no payout, eligibility, cadence or
// analytics change.
//
// Measured on the Mi 8 (vc81): checking at the moment of "shown" saw the offer mid pop-in (scale 0.85 -> 1, 360-400ms)
// and, on the bonus offer, mid pulse - the transformed box looked on screen and nothing scrolled. So the check runs
// after the pop-in and uses the LAYOUT position (offsetTop / offsetHeight), which transforms never change.

/** How long after "shown" the check runs: the longest offer entrance animation (400ms) plus a frame. */
export const OFFER_SETTLE_MS = 450;
/** Space left under the choices when they are scrolled up. */
const MARGIN_PX = 12;

/** The element's untransformed top/bottom relative to the viewport. */
function layoutBox(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
  const viewportTop = top - window.scrollY;
  return { top: viewportTop, bottom: viewportTop + el.offsetHeight };
}

/**
 * Once the offer has settled, scrolls the page just enough for `el` to be fully on screen (if it is not already).
 * Never scrolls an element that is gone or already visible, and never scrolls it above the top of the screen.
 * Returns a cancel function (call it on unmount).
 */
export function bringIntoView(el: Element | null | undefined, delayMs: number = OFFER_SETTLE_MS): () => void {
  if (!(el instanceof HTMLElement) || typeof window === "undefined") return () => {};
  const timer = window.setTimeout(() => {
    if (!el.isConnected) return;
    const box = layoutBox(el);
    if (box.bottom <= window.innerHeight && box.top >= 0) return;
    const delta = Math.min(box.bottom - window.innerHeight + MARGIN_PX, box.top - MARGIN_PX);
    if (delta <= 0) return;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* no matchMedia */
    }
    window.scrollTo({ top: window.scrollY + delta, behavior: reduced ? "auto" : "smooth" });
  }, delayMs);
  return () => window.clearTimeout(timer);
}
