import { useEffect, useRef, useState } from "react";
import { penColorById } from "../app/constants";
import { playSelectSound, playSuccessSound } from "../engine/soundEngine";
import type { InkSurface } from "../services/ads/inkTrialConfigSchema";
import type { InkTrialInk } from "../services/analyticsSchema";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { markInkCtaShown, recordInkCtaOutcome } from "../services/inkTrialStore";
import { penColorPrice, purchasePenColor } from "../services/shopPurchase";
import InkPreview from "./InkPreview";

type InkTrialCtaProps = {
  ink: InkTrialInk;
  surface: InkSurface;
  /** The card is finished (bought or NOT NOW) - the screen may drop it. */
  onClosed?: () => void;
  /** Classic: an interstitial due on this Result's exit was deferred so the CTA owns the Result (analytics only). */
  deferredInterstitial?: boolean;
};

function formatCoins(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Try -> Buy, after the last Trial play: the same premium look as the offer, the REAL Shop price (penColorPrice -
 * no Trial price, no discount, nothing hard-coded) and the Shop's own purchase path (purchasePenColor). Not an ad
 * and never in the way: it sits after the screen's own actions and the player can always just carry on.
 *
 * Affordable: UNLOCK PERMANENTLY / NOT NOW. Not affordable: the price and a friendly shortfall, NOT NOW only - never
 * an enabled button that is guaranteed to fail. One outcome per CTA: purchased, declined (NOT NOW), or dismissed
 * (the screen was left without a choice).
 */
export default function InkTrialCta({ ink, surface, onClosed, deferredInterstitial = false }: InkTrialCtaProps) {
  const option = penColorById(ink);
  const price = penColorPrice(ink) ?? 0;
  const [coins, setCoins] = useState(() => getCoins());
  const [bought, setBought] = useState(false);
  const shownRef = useRef(false);
  const decidedRef = useRef(false);

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  useEffect(() => {
    // Counted once it is really on screen (the timeout is cleared if StrictMode re-runs the effect), and a CTA left
    // without a choice reports `dismissed` exactly once.
    const t = window.setTimeout(() => {
      shownRef.current = true;
      markInkCtaShown(ink, surface, deferredInterstitial);
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (shownRef.current && !decidedRef.current) {
        decidedRef.current = true;
        recordInkCtaOutcome(ink, "dismissed", surface);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const affordable = coins >= price;

  function handleBuy() {
    if (!affordable || decidedRef.current) return;
    if (purchasePenColor(ink) !== "purchased") return;
    decidedRef.current = true;
    if (!shownRef.current) markInkCtaShown(ink, surface, deferredInterstitial);
    recordInkCtaOutcome(ink, "purchased", surface);
    playSuccessSound();
    setBought(true);
  }

  function handleNotNow() {
    if (decidedRef.current) return;
    playSelectSound();
    decidedRef.current = true;
    if (!shownRef.current) markInkCtaShown(ink, surface, deferredInterstitial);
    recordInkCtaOutcome(ink, "declined", surface);
    onClosed?.();
  }

  if (bought) {
    return (
      <div className={`ink-offer ink-offer-${ink} ink-offer-granted`} role="status">
        <div className="ink-offer-main">
          <InkPreview ink={ink} width={104} height={36} />
          <div className="ink-offer-text">
            <p className="ink-offer-title">
              {option.name} is yours forever <span aria-hidden="true">{option.icon}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ink-offer ink-offer-${ink} ink-cta`}>
      <div className="ink-offer-main">
        <InkPreview ink={ink} width={104} height={36} />
        <div className="ink-offer-text">
          <p className="ink-offer-title">Loved {option.name}?</p>
          <p className="ink-offer-value">
            Keep it forever · <span className="ink-cta-price">{formatCoins(price)} 🪙</span>
          </p>
        </div>
      </div>
      {/* Not affordable: the shortfall takes the buy button's place in the action row, so both states are two rows. */}
      <div className="ink-offer-actions">
        {affordable ? (
          <button type="button" className="ink-offer-primary" onClick={handleBuy}>
            UNLOCK PERMANENTLY
          </button>
        ) : (
          <p className="ink-cta-shortfall">Need {formatCoins(price - coins)} more 🪙</p>
        )}
        <button type="button" className="ink-offer-secondary" onClick={handleNotNow}>
          NOT NOW
        </button>
      </div>
    </div>
  );
}
