// The ONE way to buy an ink colour with coins (0.58.0): the Shop and the Ink Trial's Try -> Buy CTA both call it, so
// the price, the spend, the unlock, the auto-equip and the purchase event can never drift apart. The price is always
// the canonical Shop price (PEN_COLORS) - there is no Trial price, no discount and no price argument.

import { PEN_COLORS, type PenColorId } from "../app/constants";
import { getCoins, spendCoins } from "./coinsStore";
import { closeInkTrialOnPurchase, getInkTrialExtensions, getInkTrialHistory, setInkTrialOverlay } from "./inkTrialStore";
import { inkRefillBucket } from "./ads/inkTrialConfigSchema";
import { getUnlockedColors, setSelectedColor, unlockColor } from "./penColorStore";
import { trackEvent } from "./analytics";
import { INK_TRIAL_INKS, type InkTrialInk } from "./analyticsSchema";

export type PenColorPurchaseResult = "purchased" | "owned" | "insufficient_coins" | "not_for_sale";

/** The canonical Shop price, or null for the free default (or an unknown id). */
export function penColorPrice(id: PenColorId): number | null {
  const price = PEN_COLORS.find((c) => c.id === id)?.price;
  return typeof price === "number" && price > 0 ? price : null;
}

function isTrialInk(id: PenColorId): id is InkTrialInk {
  return (INK_TRIAL_INKS as readonly string[]).includes(id);
}

/**
 * Buy `id` at its Shop price. Never spends unless the purchase completes: an owned colour, a free/unknown id and a
 * balance below the price all return without touching anything. On success the colour is unlocked and equipped
 * (the Shop's long-standing auto-select), the purchase is reported exactly as the Shop always reported it, and a
 * running Ink Trial for that ink is closed - permanent ownership wins at once.
 */
export function purchasePenColor(id: PenColorId): PenColorPurchaseResult {
  const price = penColorPrice(id);
  if (price === null) return "not_for_sale";
  if (getUnlockedColors().includes(id)) return "owned";
  if (getCoins() < price) return "insufficient_coins";
  // A Trial ink's history is read before the purchase closes its Trial (aggregate Trial -> Shop attribution).
  const inkTrialBefore = isTrialInk(id) ? getInkTrialHistory(id) : null;
  const refills = isTrialInk(id) ? getInkTrialExtensions(id) : 0;
  spendCoins(price, "pen_color");
  unlockColor(id);
  setSelectedColor(id);
  if (isTrialInk(id)) closeInkTrialOnPurchase(id);
  // The Shop has always equipped what was just bought: a running Trial of ANOTHER ink steps aside (paused, not
  // ended - it comes back when its ink is picked in the pen menu, and no play is used while it is paused). After
  // buying the Trial's own ink this is a no-op: that Trial was just closed, and the next grant resets the overlay.
  setInkTrialOverlay(false);
  trackEvent("shop_purchase_with_coins", {
    productType: "penColor",
    tier: id,
    price,
    ...(inkTrialBefore ? { inkTrialBefore } : {}),
    ...(inkTrialBefore && inkTrialBefore !== "none" && refills > 0 ? { inkRefill: inkRefillBucket(refills) } : {}),
  });
  return "purchased";
}
