import { useEffect, useRef, useState } from "react";
import { penColorById } from "../app/constants";
import { TRIAL_PLAYS } from "../app/inkTrialPolicy";
import { playChipSound, playSelectSound, playSuccessSound } from "../engine/soundEngine";
import { isRewardedAdAvailable, preloadRewardedAd, showRewardedAd, type RewardedAdPlacement } from "../services/ads";
import type { InterstitialCellId } from "../services/ads/interstitialConfigSchema";
import type { InkRotationSlot, InkSurface } from "../services/ads/inkTrialConfigSchema";
import { trackEvent } from "../services/analytics";
import type { InkTrialInk, RewardInterstitialArm, RewardOfferParams, RewardSkipStage } from "../services/analyticsSchema";
import { grantInkTrial, recordInkOfferRendered } from "../services/inkTrialStore";
import { resolveAdOutcome } from "./doubleOfferAdFlow";
import { isMathFallbackEnabled } from "./DoubleCoinsOffer";
import InkPreview from "./InkPreview";

/** The analytics context of one rendered Ink offer (analyticsSchema RewardOfferInk). */
export type InkOfferContext = {
  offerNumber: number;
  sessionGames: number;
  interstitialArm?: RewardInterstitialArm;
  ifxCell?: InterstitialCellId;
  /** Classic only: what the coin/ink rotation scheduled (always "ink" for a rendered Ink offer). */
  rotationSlot?: InkRotationSlot;
};

type InkTrialOfferProps = {
  ink: InkTrialInk;
  surface: Exclude<InkSurface, "daily">;
  placement: RewardedAdPlacement;
  context: InkOfferContext;
  /** Once, in the same tick as reward_offer_shown: the offer counts as rendered from here. */
  onShown?: () => void;
  /** The card has nothing left to decide: the Trial was granted, or the player said NOT NOW. */
  onClosed?: (outcome: "granted" | "declined") => void;
  /** Called once on mount with a function that records leaving the screen with the offer still open, as NOT NOW would. */
  onSkipReporter?: (report: () => void) => void;
};

type Phase = "offer" | "granted";

/**
 * The Rewarded Ink Trial offer: a compact premium card that previews the REAL ink and offers TRIAL_PLAYS plays of
 * it for one rewarded ad. Never a takeover - it sits in the screen's flow, never covers results or controls, and
 * never opens an ad by itself: only the WATCH AD & TRY tap does.
 *
 * Same rewarded flow and funnel events as the coin offer (DoubleCoinsOffer): reward_offer_shown on render,
 * reward_ad_started on the tap, reward_ad_completed / reward_ad_failed after it, reward_skipped (with skipStage)
 * when given up - all under this card's own placement and the Ink context block, so Ink and Coin stay separable.
 * The Trial is granted ONLY on the SDK's confirmed reward (resolveAdOutcome "rewarded"); an early close, a failed
 * or an unavailable ad grants nothing and leaves the card as it was.
 */
export default function InkTrialOffer({ ink, surface, placement, context, onShown, onClosed, onSkipReporter }: InkTrialOfferProps) {
  const option = penColorById(ink);
  const [phase, setPhase] = useState<Phase>("offer");
  const [adPending, setAdPending] = useState(false);
  const [adUnavailable, setAdUnavailable] = useState(false);
  const [grantRefused, setGrantRefused] = useState(false);
  const adDismissedRef = useRef(false);
  const settledRef = useRef(false);
  // Capability at render (the same stable check the coin offer reports as adAvailable) - frozen for the funnel.
  const [adAvailableAtRender] = useState(() => isRewardedAdAvailable());
  const devSimulation = isMathFallbackEnabled();
  const canWatch = isRewardedAdAvailable() || devSimulation;

  const funnelParams = (skipStage?: RewardSkipStage): RewardOfferParams & { skipStage?: RewardSkipStage } => ({
    placement,
    ink,
    offerNumber: context.offerNumber,
    sessionGames: context.sessionGames,
    adAvailable: adAvailableAtRender,
    ...(context.interstitialArm !== undefined ? { interstitialArm: context.interstitialArm } : {}),
    ...(context.ifxCell !== undefined ? { ifxCell: context.ifxCell } : {}),
    ...(context.rotationSlot !== undefined ? { rotationSlot: context.rotationSlot } : {}),
    ...(skipStage ? { skipStage } : {}),
  });

  /** One skip per offer: "ad" when an ad was shown and closed without the reward earlier, else "offer". */
  function reportSkip() {
    if (settledRef.current) return;
    settledRef.current = true;
    trackEvent("reward_skipped", funnelParams(adDismissedRef.current ? "ad" : "offer"));
  }

  const shownRef = useRef(false);
  useEffect(() => {
    void preloadRewardedAd(placement);
    onSkipReporter?.(reportSkip);
    // Cleared if StrictMode re-runs the effect, so the render is counted exactly once.
    const t = window.setTimeout(() => {
      shownRef.current = true;
      trackEvent("reward_offer_shown", funnelParams());
      recordInkOfferRendered(ink);
      onShown?.();
    }, 0);
    return () => {
      window.clearTimeout(t);
      // Leaving the screen with the offer still open (Back, a header shortcut, Android Back): the same one skip
      // NOT NOW records. A screen that already reported through onSkipReporter, a NOT NOW or a grant settled it.
      if (shownRef.current) reportSkip();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function grant() {
    const granted = grantInkTrial(ink, surface);
    settledRef.current = true;
    trackEvent("reward_ad_completed", funnelParams());
    playSuccessSound();
    if (!granted) setGrantRefused(true);
    setPhase("granted");
    onClosed?.("granted");
  }

  async function handleWatch() {
    if (adPending) return;
    playChipSound();
    trackEvent("reward_ad_started", funnelParams());
    setAdUnavailable(false);
    // Dev server only (no ad can ever load there): the dev build simulates the confirmed reward so the flow can be
    // exercised. isMathFallbackEnabled() is false in every production bundle.
    if (!isRewardedAdAvailable() && devSimulation) {
      grant();
      return;
    }
    setAdPending(true);
    const result = await showRewardedAd(placement);
    setAdPending(false);
    const outcome = resolveAdOutcome(result);
    if (outcome.grantSource === "ad") {
      grant();
    } else if (outcome.dismissed) {
      // Shown and closed without the reward: a skip, not a failure. The card stays; the eventual skip says "ad".
      adDismissedRef.current = true;
    } else {
      trackEvent("reward_ad_failed", funnelParams());
      if (outcome.adUnavailable) setAdUnavailable(true);
    }
  }

  function handleNotNow() {
    if (adPending) return;
    playSelectSound();
    reportSkip();
    onClosed?.("declined");
  }

  if (phase === "granted") {
    return (
      <div className={`ink-offer ink-offer-${ink} ink-offer-granted`} role="status">
        <div className="ink-offer-main">
          <InkPreview ink={ink} width={104} height={36} />
          <div className="ink-offer-text">
            {grantRefused ? (
              <p className="ink-offer-title">{option.name} is already yours {option.icon}</p>
            ) : (
              <>
                <p className="ink-offer-title">
                  {option.name} unlocked {option.icon}
                </p>
                <p className="ink-offer-value">On your pen for {TRIAL_PLAYS} plays</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ink-offer ink-offer-${ink}`}>
      <div className="ink-offer-main">
        <InkPreview ink={ink} width={104} height={36} />
        <div className="ink-offer-text">
          <p className="ink-offer-title">
            Try {option.name} <span aria-hidden="true">{option.icon}</span>
          </p>
          <p className="ink-offer-value">Use it for {TRIAL_PLAYS} plays</p>
        </div>
      </div>
      {adUnavailable && <p className="ink-offer-note">Ads aren’t available right now.</p>}
      <div className="ink-offer-actions">
        {canWatch && (
          <button type="button" className="ink-offer-primary" onClick={handleWatch} disabled={adPending}>
            {adPending ? "Loading ad…" : "WATCH AD & TRY"}
          </button>
        )}
        <button type="button" className="ink-offer-secondary" onClick={handleNotNow} disabled={adPending}>
          NOT NOW
        </button>
      </div>
    </div>
  );
}
