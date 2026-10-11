// 0.59.0: a Rewarded offer counts as shown the moment it is rendered (reward_offer_shown, after any streak card has
// closed - app/streakCardGate.ts). On a short phone its choices can still sit below the fold of a long result screen,
// so at that same moment they are brought into view once, by as little as needed. Layout only: no payout,
// eligibility, cadence or analytics change.

/** Scrolls `el` just enough to be fully on screen, if it is not already. */
export function bringIntoView(el: Element | null | undefined): void {
  if (!el || typeof window === "undefined") return;
  const r = el.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  let reduced = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    /* no matchMedia */
  }
  el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
