import { useEffect, useRef, useState } from "react";
import { playChipSound, playCoinsSound, playDangerSound, playSelectSound, playSuccessSound } from "../engine/soundEngine";
import { MAX_PAID_CHEST_DOUBLES_PER_DAY } from "../services/chestDoubleLimitStore";
import { isRewardedAdAvailable, preloadRewardedAd, showRewardedAd, type RewardedAdPlacement } from "../services/ads";
import { trackEvent } from "../services/analytics";
import { consumesDoubleAttempt, resolveAdOutcome } from "./doubleOfferAdFlow";

type DoubleCoinsOfferProps = {
  /** The coin reward already earned and guaranteed - doubling only ever adds on top of this, never takes it away. */
  amount: number;
  /** Called once the player's decision is final, with the coin total to actually credit and the element to fly the coin animation from. */
  onResolved: (finalAmount: number, anchorEl: HTMLElement | null) => void;
  /** Which rewarded-ad trigger point this offer represents - keeps ad analytics attributed to the right screen. */
  placement: RewardedAdPlacement;
  /** Remaining doubles under a daily cap (paid shop chests) - omit for unlimited (Daily Chest, challenge rewards). When 0, the double option is hidden and only the base reward can be collected. */
  remainingDoubles?: number;
  /** Called once, ONLY after a double has actually been granted, so the caller can count it against its daily cap. A failed, blocked, unavailable or early-closed ad grants nothing and must therefore cost nothing. Only meaningful alongside `remainingDoubles`. */
  onDoubleAttempted?: () => void;
};

type Phase = "offer" | "quiz" | "feedback";
type GrantSource = "ad" | "quiz";

function randomFactor(): number {
  return 1 + Math.floor(Math.random() * 10);
}

/**
 * Is the math-quiz route to the double available? DEV BUILDS ONLY - it exists purely so
 * the doubling flow can be exercised on the web dev server, where no rewarded ad can
 * ever be served. It must never be reachable in a build that goes to users.
 *
 * Deliberately FAIL-CLOSED, unlike the isDevBuild() helpers in adConfig.ts /
 * analytics.ts / artistPackLibrary.ts: those treat an unknown environment as dev so
 * dev-only content stays visible to the Node test runner, but here an unknown
 * environment must resolve to "no math route" - the safe direction for something whose
 * whole purpose is that players cannot reach it. `import.meta.env.DEV` is statically
 * replaced at build time, so this is false in every production bundle.
 */
function isMathFallbackEnabled(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

/**
 * Flashing "double or nothing" offer shown after a coin reward. Skipping keeps the
 * original amount unchanged.
 *
 * Watching a rewarded video ad is the ONLY way a player can double their coins: the
 * grant happens exclusively on the SDK's own confirmed reward callback (see
 * doubleOfferAdFlow.ts), never merely on opening the ad. When no ad can be served (ads
 * disabled, no consent, on the web, not configured) or an ad attempt fails, the player
 * is NOT granted the double and is NOT offered any substitute - they just see a short
 * "ads aren't available right now" note and keep the coins they already earned. Nothing
 * here can ever leave a player with less than they earned.
 *
 * The math quiz is retained as a DEV-ONLY route (isMathFallbackEnabled) so the doubling
 * flow stays testable on the dev server, where a rewarded ad is never available. It is
 * absent from every user-facing build.
 *
 * Callers with a daily cap (paid shop chests) pass `remainingDoubles` and `onDoubleAttempted`;
 * once the cap is hit, the double option disappears and only the base reward remains
 * collectible, with the current count shown to the player.
 */
export default function DoubleCoinsOffer({ amount, onResolved, placement, remainingDoubles, onDoubleAttempted }: DoubleCoinsOfferProps) {
  const [phase, setPhase] = useState<Phase>("offer");
  const [question] = useState(() => ({ a: randomFactor(), b: randomFactor() }));
  const [answer, setAnswer] = useState("");
  const [wasCorrect, setWasCorrect] = useState(false);
  const [grantSource, setGrantSource] = useState<GrantSource>("quiz");
  const [adPending, setAdPending] = useState(false);
  const [adUnavailableNotice, setAdUnavailableNotice] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const doublingAvailable = remainingDoubles === undefined || remainingDoubles > 0;
  const adAvailable = isRewardedAdAvailable();
  const mathFallbackEnabled = isMathFallbackEnabled();
  // Whether any route to the double actually exists right now - drives the headline so
  // we never ask "double it?" when nothing can deliver it.
  const canAttemptDouble = doublingAvailable && (adAvailable || mathFallbackEnabled);
  // No ad, and no dev math route: say so quietly rather than offering a dead button.
  const showNoAdNotice = doublingAvailable && (adUnavailableNotice || (!adAvailable && !mathFallbackEnabled));

  useEffect(() => {
    preloadRewardedAd(placement);
    trackEvent("reward_offer_shown", { placement });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSkip() {
    playSelectSound();
    trackEvent("reward_skipped", { placement });
    onResolved(amount, anchorRef.current);
  }

  function handleChooseDouble() {
    playChipSound();
    trackEvent("reward_fallback_used", { placement });
    setPhase("quiz");
  }

  async function handleWatchAd() {
    playChipSound();
    trackEvent("reward_ad_started", { placement });
    setAdPending(true);
    const result = await showRewardedAd(placement);
    setAdPending(false);
    const outcome = resolveAdOutcome(result);
    // Charged against the daily cap only once the ad has actually granted the double -
    // an unavailable, blocked, failed, timed-out or early-closed ad costs the player
    // nothing and leaves them free to try again.
    if (consumesDoubleAttempt(outcome)) onDoubleAttempted?.();
    if (outcome.grantSource === "ad") {
      playSuccessSound();
      playCoinsSound();
      setGrantSource("ad");
      setWasCorrect(true);
      trackEvent("reward_ad_completed", { placement });
    } else {
      trackEvent("reward_ad_failed", { placement });
      // No substitute route is offered - just a quiet notice back on the offer screen.
      if (outcome.adUnavailable) setAdUnavailableNotice(true);
    }
    setPhase(outcome.nextPhase);
  }

  function handleSubmitAnswer(e: React.FormEvent) {
    e.preventDefault();
    const correct = Number(answer) === question.a * question.b;
    setGrantSource("quiz");
    setWasCorrect(correct);
    setPhase("feedback");
    if (correct) {
      // Same rule as the ad route: the cap is charged only when a double is granted.
      onDoubleAttempted?.();
      playSuccessSound();
      playCoinsSound();
    } else {
      playDangerSound();
    }
  }

  function handleContinue() {
    onResolved(wasCorrect ? amount * 2 : amount, anchorRef.current);
  }

  return (
    <div ref={anchorRef} className="double-offer-banner">
      {phase === "offer" && (
        <>
          <p className="double-offer-headline">
            {canAttemptDouble ? `🪙 +${amount} coins - double it?` : `🪙 +${amount} coins`}
          </p>
          {remainingDoubles !== undefined && (
            <p className="double-offer-limit-note">
              Chest doubles left today: {remainingDoubles}/{MAX_PAID_CHEST_DOUBLES_PER_DAY}
            </p>
          )}
          {showNoAdNotice && <p className="double-offer-limit-note">Ads aren’t available right now.</p>}
          <div className="double-offer-buttons">
            {doublingAvailable && adAvailable && (
              <button type="button" className="double-offer-double double-offer-ad-primary" onClick={handleWatchAd} disabled={adPending}>
                {adPending ? "Loading ad…" : "🎬 Watch Ad to Double"}
              </button>
            )}
            {/* Dev-only: never rendered in a user-facing build (see isMathFallbackEnabled). */}
            {doublingAvailable && mathFallbackEnabled && (
              <button type="button" className="double-offer-double" onClick={handleChooseDouble} disabled={adPending}>
                🧮 Solve Math (dev)
              </button>
            )}
            <button type="button" className="double-offer-skip" onClick={handleSkip} disabled={adPending}>
              {canAttemptDouble ? "Skip" : "Continue"}
            </button>
          </div>
        </>
      )}
      {phase === "quiz" && (
        <form onSubmit={handleSubmitAnswer} className="double-offer-quiz">
          <p className="double-offer-headline">
            Solve it to double your coins: {question.a} × {question.b} = ?
          </p>
          <div className="double-offer-quiz-row">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              value={answer}
              onChange={(e) => setAnswer(e.target.value.replace(/[^0-9]/g, ""))}
              className="double-offer-input"
              aria-label="Your answer"
            />
            <button type="submit" className="double-offer-double" disabled={answer.trim() === ""}>
              Submit
            </button>
          </div>
        </form>
      )}
      {phase === "feedback" && (
        <>
          {wasCorrect && grantSource === "ad" ? (
            <p className="double-offer-headline">✅ Ad watched! You doubled your coins: 🪙 +{amount * 2}</p>
          ) : wasCorrect ? (
            <p className="double-offer-headline">✅ Correct! You doubled your coins: 🪙 +{amount * 2}</p>
          ) : (
            <p className="double-offer-headline">
              ❌ Not quite - {question.a} × {question.b} = {question.a * question.b}. You keep your original 🪙 +{amount}.
            </p>
          )}
          <div className="double-offer-buttons">
            <button type="button" className="double-offer-double" onClick={handleContinue}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
