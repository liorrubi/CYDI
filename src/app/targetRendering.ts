/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * How the target shape is drawn, as one rule instead of eight copies of it.
 *
 * THE CONVENTION, on Android:
 *
 *   solid, alone                  the shape to remember, during preview
 *   dashed, alone                 the optional guide, while drawing
 *   dashed beside a solid line    the target on a result comparison
 *
 * The third one is why this is a convention rather than "solid is the target":
 * on a result the dash is what separates the target from the player's own
 * stroke in a single image, so it stays dashed there and `ShapeOverlayCanvas`
 * is not involved in this rule at all.
 *
 * WHY IT IS NATIVE-ONLY. The convention was decided and verified for the Android
 * app. The web keeps the render it has today, so this returns false there and
 * every web caller is unchanged.
 *
 * WHY THIS EXISTS. Eight call sites need the same platform-gated decision, and
 * repeating `Capacitor.isNativePlatform()` eight times would leave the rule
 * implicit and easy to get half-right. Nothing else belongs in here - this is
 * not a platform abstraction, it is one rendering rule.
 */
import { Capacitor } from "@capacitor/core";

/**
 * True when the target should be drawn solid rather than dashed.
 *
 * @param isPreview the mode's own "the shape is being shown to be memorised"
 *   state - `phase === "preview"`, `showsTargetShape(phase)`, whatever that mode
 *   really calls it. Deliberately NOT the mode's `showGuide`/`showGhost` flag:
 *   in Classic and Artist Pack that is also true while drawing, and the guide
 *   must stay dashed.
 */
export function solidTargetInPreview(isPreview: boolean): boolean {
  return Capacitor.isNativePlatform() && isPreview;
}
