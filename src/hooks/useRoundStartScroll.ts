/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Round-start scroll positioning, shared by every gameplay mode.
 *
 * THE BUG THIS FIXES. Screens are plain React state (App.tsx navigate()), and every mode
 * switches study -> drawing -> result -> next round inside one component, so nothing ever
 * moved the page: a round started at whatever scroll position the previous screen - a long
 * shape map, a Mega album, a result screen, the Pass & Play setup form - happened to leave,
 * with the top of the target/canvas above the viewport (measured on the Mi 8: canvas top at
 * -97 px after a map scrolled to 250, fully off-screen after a Mega album scrolled to 900).
 *
 * WHAT IT DOES. When a round (or a player's turn) begins, the game's root - the enclosing
 * `.screen` - is brought to the top of the viewport, instantly (no animation), and ONLY if
 * its top is currently above the viewport. A round that already starts in view is never
 * moved, so there is no jump on the ordinary path and nothing happens on desktop. It
 * positions the game container, not the document: on the web the site chrome above the game
 * simply scrolls away, exactly as far as needed.
 *
 * Deliberately NOT a global scrollTo(0,0) in navigate(): returning to a long map or list
 * keeps working as before (see useListScrollMemory for the lists that host a round in-place).
 */
import { useLayoutEffect, useRef } from "react";

/** Brings the game root's top to the viewport top if it is above it. Instant; a no-op when already in view. */
export function scrollGameRootIntoView(anchor?: Element | null): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const root = (anchor?.closest(".screen") ?? anchor ?? document.querySelector(".screen")) as HTMLElement | null;
  if (!root) return;
  const top = root.getBoundingClientRect().top;
  if (top >= 0) return;
  window.scrollTo({ top: Math.max(0, window.scrollY + top), left: 0, behavior: "instant" as ScrollBehavior });
}

/**
 * Runs scrollGameRootIntoView before paint whenever `roundKey` changes to a non-false value -
 * i.e. each time a round or turn starts. Pass a key that is `false` outside the round-start
 * phases and changes for every new round/turn (a phase name, a round index, a turn key).
 */
export function useRoundStartScroll(roundKey: string | number | false | null | undefined): void {
  useLayoutEffect(() => {
    if (roundKey === false || roundKey === null || roundKey === undefined) return;
    scrollGameRootIntoView();
  }, [roundKey]);
}

/**
 * For a list that hosts rounds IN PLACE (the Classic shape map, the Mega album, the Artist
 * gallery): remembers the list's scroll position when a round replaces it and restores it
 * when the list comes back, so a player returning from a round lands where they were in the
 * list instead of at whatever the round left.
 */
export function useListScrollMemory(listVisible: boolean): void {
  const saved = useRef<number | null>(null);
  // Read during render, i.e. BEFORE this render's DOM changes are committed: the render that
  // swaps the list for a round still sees the list's real scroll position. (Reading scrollY
  // in the effect cleanup would be too late - the page is already the shorter round and the
  // browser has clamped scrollY to it.)
  const renderScrollY = useRef(0);
  renderScrollY.current = typeof window === "undefined" ? 0 : window.scrollY;
  useLayoutEffect(() => {
    if (!listVisible) return;
    if (saved.current !== null) {
      window.scrollTo({ top: saved.current, left: 0, behavior: "instant" as ScrollBehavior });
      saved.current = null;
    }
    return () => {
      saved.current = renderScrollY.current;
    };
  }, [listVisible]);
}
