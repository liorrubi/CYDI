/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// When a pointerdown may begin a new stroke.
//
// Its own module so it can be asserted without React: the rule it encodes is
// the difference between "ignore a second finger" and "ignore every touch for
// the rest of this canvas's life", and that difference was a reported bug.

/**
 * Whether a pointerdown may begin a new stroke.
 *
 * The rule this replaces was "ignore any touch while another pointer is
 * recorded", which is right for a genuine second finger and catastrophic for a
 * pointer that is recorded but no longer real. The recorded id is only ever
 * cleared by a matching pointerup / pointerleave / pointercancel, so if the
 * browser never delivers one - which happens when a captured pointer's element
 * is re-rendered, or when the system steals the gesture - the canvas silently
 * ignores every touch from then on while still looking completely normal. That
 * is exactly the reported failure: a live-looking canvas that cannot be drawn
 * on.
 *
 * Pointer capture is the thing that can be asked. If the recorded pointer is
 * still captured it is a real finger still on the glass and the new one is
 * ignored, as before. If capture is gone, the recorded id is a ghost and the
 * new pointer takes over.
 */
export function canStartStroke(activePointerId: number | null, stillCaptured: (id: number) => boolean): boolean {
  if (activePointerId === null) return true;
  return !stillCaptured(activePointerId);
}

/** Pointer capture is not implemented everywhere (jsdom, older WebViews); treat "cannot tell" as "not captured" so a stale id can never wedge the canvas. */
export function hasCapture(element: Element, pointerId: number): boolean {
  try {
    return element.hasPointerCapture(pointerId);
  } catch {
    return false;
  }
}
