import { useEffect, useRef, useState } from "react";
import { penColorById } from "../app/constants";
import { TRIAL_EXTENSION_PLAYS, extensionAdStep } from "../app/inkTrialPolicy";
import { playChipSound, playSelectSound, playSuccessSound } from "../engine/soundEngine";
import { isRewardedAdAvailable, preloadRewardedAd, showRewardedAd, type RewardedAdPlacement } from "../services/ads";
import type { InkSurface } from "../services/ads/inkTrialConfigSchema";
import { trackEvent } from "../services/analytics";
import type { InkTrialInk, RewardOfferParams, RewardSkipStage } from "../services/analyticsSchema";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { grantInkTrialExtension, isInkTrialExtended, markInkCtaShown, recordInkCtaOutcome } from "../services/inkTrialStore";
import { canOfferInkExtensionOn } from "../services/inkTrialOffers";
import { penColorPrice, purchasePenColor } from "../services/shopPurchase";
import { isMathFallbackEnabled } from "./DoubleCoinsOffer";
import InkPreview from "./InkPreview";

type InkTrialCtaProps = {
  ink: InkTrialInk;
  surface: Exclude<InkSurface, "daily">;
  /** This surface's Ink placement - the one-time extension's ad serves from the Ink unit, like the Trial offer. */
  placement: RewardedAdPlacement;
  /** The extension offer's analytics context: completed games (Classic) / sessions (Play Together, 2 Players) so far. */
  sessionGames: number;
  /** VIEW IN SHOP: open the existing Shop on this ink (the screen owns navigation). */
  onViewShop: (ink: InkTrialInk) => void;
  /** The card is finished (bought, extended or NOT NOW) - the screen may drop it. */
  onClosed?: () => void;
  /** Classic: an interstitial due on this Result's exit was deferred so the CTA owns the Result (analytics only). */
  deferredInterstitial?: boolean;
};

function formatCoins(n: number): string {
  return n.toLocaleString("en-US");
}

type Phase = "offer" | "bought" | "extended";

/**
 * The Keep-it card, after a Trial phase's last play: the same premium look as the offer, the REAL Shop price
 * (penColorPrice - no Trial price, no discount, nothing hard-coded) and the Shop's own purchase path
 * (purchasePenColor). Always actionable, never in the way: it sits after the screen's own actions.
 *
 * First card (the first 5 plays used, the extension still possible on this surface):
 *   affordable   UNLOCK INK  ·  WATCH AD · +5 PLAYS   ·  not now
 *   unaffordable WATCH AD · +5 PLAYS ·  VIEW IN SHOP          ·  need X more · not now
 * Final card (the extension used - or not possible here): buy or Shop only.
 *   affordable   UNLOCK INK  ·  NOT NOW
 *   unaffordable VIEW IN SHOP        ·  NOT NOW               ·  need X more
 *
 * The +5 extension is granted ONLY on the SDK's confirmed reward (resolveAdOutcome "rewarded"), once per ink
 * (grantInkTrialExtension refuses a second one); a failed, unavailable or early-closed ad grants nothing. Its ad
 * funnel is the Ink offer's (same placement / unit / single lane), marked inkExtension.
 * One outcome per card: purchased, declined (NOT NOW), dismissed (left without a choice), shop, or extended.
 */
export default function InkTrialCta({ ink, surface, placement, sessionGames, onViewShop, onClosed, deferredInterstitial = false }: InkTrialCtaProps) {
  const option = penColorById(ink);
  const price = penColorPrice(ink) ?? 0;
  const [coins, setCoins] = useState(() => getCoins());
  const [phase, setPhase] = useState<Phase>("offer");
  const [adPending, setAdPending] = useState(false);
  const [adUnavailable, setAdUnavailable] = useState(false);
  const shownRef = useRef(false);
  const decidedRef = useRef(false);
  const adPendingRef = useRef(false);
  const adDismissedRef = useRef(false);
  const extensionSettledRef = useRef(false);
  const devSimulation = isMathFallbackEnabled();
  // Decided once, at render: does THIS card offer the +5 extension? (Not after it was used; not where it cannot run.)
  const [finalCard] = useState(() => isInkTrialExtended(ink));
  const [extensionOffered] = useState(() => !finalCard && canOfferInkExtensionOn(surface, ink) && (isRewardedAdAvailable(placement) || devSimulation));
  const [adAvailableAtRender] = useState(() => isRewardedAdAvailable(placement));

  const funnelParams = (skipStage?: RewardSkipStage): RewardOfferParams & { skipStage?: RewardSkipStage } => ({
    placement,
    ink,
    offerNumber: 1,
    sessionGames: Math.max(0, Math.min(999, sessionGames)),
    adAvailable: adAvailableAtRender,
    inkExtension: true,
    ...(skipStage ? { skipStage } : {}),
  });

  /** The card ended without the extension: its offer is settled as one skip ("ad" if an ad was closed early). */
  function settleExtensionSkip() {
    if (!extensionOffered || extensionSettledRef.current) return;
    extensionSettledRef.current = true;
    trackEvent("reward_skipped", funnelParams(adDismissedRef.current ? "ad" : "offer"));
  }

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  useEffect(() => {
    if (extensionOffered) void preloadRewardedAd(placement);
    // Counted once it is really on screen (the timeout is cleared if StrictMode re-runs the effect), and a CTA left
    // without a choice reports `dismissed` exactly once. Not while the extension's ad is on screen: its answer settles it.
    const t = window.setTimeout(() => {
      shownRef.current = true;
      markInkCtaShown(ink, surface, deferredInterstitial);
      if (extensionOffered) trackEvent("reward_offer_shown", funnelParams());
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (shownRef.current && !decidedRef.current && !adPendingRef.current) {
        decidedRef.current = true;
        recordInkCtaOutcome(ink, "dismissed", surface);
        settleExtensionSkip();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const affordable = coins >= price;

  function ensureShown() {
    if (shownRef.current) return;
    shownRef.current = true;
    markInkCtaShown(ink, surface, deferredInterstitial);
  }

  function handleBuy() {
    if (!affordable || decidedRef.current || adPending) return;
    if (purchasePenColor(ink) !== "purchased") return;
    decidedRef.current = true;
    ensureShown();
    recordInkCtaOutcome(ink, "purchased", surface);
    settleExtensionSkip();
    playSuccessSound();
    setPhase("bought");
  }

  function handleShop() {
    if (decidedRef.current || adPending) return;
    playSelectSound();
    decidedRef.current = true;
    ensureShown();
    recordInkCtaOutcome(ink, "shop", surface);
    settleExtensionSkip();
    onViewShop(ink);
  }

  function handleNotNow() {
    if (decidedRef.current || adPending) return;
    playSelectSound();
    decidedRef.current = true;
    ensureShown();
    recordInkCtaOutcome(ink, "declined", surface);
    settleExtensionSkip();
    onClosed?.();
  }

  function grantExtension() {
    if (!grantInkTrialExtension(ink, surface)) {
      // No longer possible (bought meanwhile / already extended): nothing granted, the card stays a buy/Shop card.
      trackEvent("reward_ad_failed", funnelParams());
      return;
    }
    decidedRef.current = true;
    extensionSettledRef.current = true;
    trackEvent("reward_ad_completed", funnelParams());
    playSuccessSound();
    setPhase("extended");
  }

  async function handleWatch() {
    if (adPending || decidedRef.current) return;
    playChipSound();
    ensureShown();
    trackEvent("reward_ad_started", funnelParams());
    setAdUnavailable(false);
    // Dev server only (no ad can ever load there): the dev build simulates the confirmed reward so the flow can be
    // exercised. isMathFallbackEnabled() is false in every production bundle.
    if (!isRewardedAdAvailable(placement) && devSimulation) {
      grantExtension();
      return;
    }
    setAdPending(true);
    adPendingRef.current = true;
    const result = await showRewardedAd(placement);
    adPendingRef.current = false;
    setAdPending(false);
    const step = extensionAdStep(result.status);
    if (step === "grant") {
      grantExtension();
    } else if (step === "dismissed") {
      // Shown and closed without the reward: nothing granted, the card stays; the eventual skip says "ad".
      adDismissedRef.current = true;
    } else {
      // No fill, timeout or an SDK error: nothing granted, the card stays with the usual note.
      trackEvent("reward_ad_failed", funnelParams());
      setAdUnavailable(true);
    }
  }

  if (phase === "bought" || phase === "extended") {
    return (
      <div className={`ink-offer ink-offer-${ink} ink-offer-granted`} role="status">
        <div className="ink-offer-main">
          <InkPreview ink={ink} width={104} height={36} />
          <div className="ink-offer-text">
            {phase === "bought" ? (
              <p className="ink-offer-title">
                {option.name} unlocked! <span aria-hidden="true">{option.icon}</span>
              </p>
            ) : (
              <>
                <p className="ink-offer-title">
                  {TRIAL_EXTENSION_PLAYS} more plays <span aria-hidden="true">{option.icon}</span>
                </p>
                <p className="ink-offer-value">
                  {option.name} is back on your pen
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const watchLabel = adPending ? "Loading ad…" : "WATCH AD · +5 PLAYS";
  const shortfall = !affordable && <p className="ink-cta-shortfall">Need {formatCoins(price - coins)} more 🪙</p>;
  const notNowLink = (
    <button type="button" className="ink-cta-notnow" onClick={handleNotNow} disabled={adPending}>
      NOT NOW
    </button>
  );

  return (
    <div className={`ink-offer ink-offer-${ink} ink-cta`}>
      <div className="ink-offer-main">
        <InkPreview ink={ink} width={104} height={36} />
        <div className="ink-offer-text">
          <p className="ink-offer-title">{finalCard ? `${option.name} trial ended` : `Loved ${option.name}?`}</p>
          <p className="ink-offer-value">
            Unlock {option.name} · <span className="ink-cta-price">{formatCoins(price)} 🪙</span>
          </p>
        </div>
      </div>
      {adUnavailable && <p className="ink-offer-note">Ads aren’t available right now.</p>}
      {extensionOffered ? (
        <>
          <div className="ink-offer-actions">
            {affordable ? (
              <>
                <button type="button" className="ink-offer-primary" onClick={handleBuy} disabled={adPending}>
                  UNLOCK INK
                </button>
                <button type="button" className="ink-offer-secondary ink-cta-watch" onClick={handleWatch} disabled={adPending}>
                  {adPending ? (
                    watchLabel
                  ) : (
                    <span className="ink-cta-lines">
                      <span>WATCH AD</span>
                      <span>+5 PLAYS</span>
                    </span>
                  )}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ink-offer-primary" onClick={handleWatch} disabled={adPending}>
                  {watchLabel}
                </button>
                <button type="button" className="ink-offer-secondary" onClick={handleShop} disabled={adPending}>
                  VIEW IN SHOP
                </button>
              </>
            )}
          </div>
          <div className="ink-cta-foot">
            {shortfall}
            {notNowLink}
          </div>
        </>
      ) : (
        <>
          <div className="ink-offer-actions">
            {affordable ? (
              <button type="button" className="ink-offer-primary" onClick={handleBuy}>
                UNLOCK INK
              </button>
            ) : (
              <button type="button" className="ink-offer-primary" onClick={handleShop}>
                VIEW IN SHOP
              </button>
            )}
            <button type="button" className="ink-offer-secondary" onClick={handleNotNow}>
              NOT NOW
            </button>
          </div>
          {shortfall && <div className="ink-cta-foot">{shortfall}</div>}
        </>
      )}
    </div>
  );
}
