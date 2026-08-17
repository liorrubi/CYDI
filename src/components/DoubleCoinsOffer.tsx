import { useEffect, useRef, useState } from "react";
import {
  playAchievementUnlockedSound,
  playChipSound,
  playCoinsSound,
  playDangerSound,
  playSelectSound,
  playSuccessSound,
} from "../engine/soundEngine";
import { MAX_PAID_CHEST_DOUBLES_PER_DAY } from "../services/chestDoubleLimitStore";
import { isRewardedAdAvailable, preloadRewardedAd, showRewardedAd, type RewardedAdPlacement } from "../services/ads";
import { trackEvent } from "../services/analytics";
import { markDoubleRewardTutorialShown, shouldShowDoubleRewardTutorial } from "../services/tutorialStore";
import { consumesDoubleAttempt, resolveAdOutcome } from "./doubleOfferAdFlow";
import {
  isBonusRewardRound,
  resolveBonusRewardRound,
  rewardMultiplier,
  STANDARD_REWARD_MULTIPLIER,
} from "../app/bonusRewardRound";
import {
  areRewardNudgesEnabled,
  markReminderShown,
  recordOfferSkipped,
  recordRewardGranted,
  shouldShowReminder,
} from "../app/rewardOfferNudge";

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

  // Frozen at mount from a PURE read, so a re-render can never flip the offer's
  // identity halfway through (and StrictMode's double invocation is harmless).
  const [isBonusRound] = useState(() => isBonusRewardRound(placement));
  /** What this offer advertises: 3 on a bonus round, otherwise the usual 2. */
  const multiplier = rewardMultiplier(isBonusRound);
  /** What actually gets PAID. The 3× is reserved for a confirmed rewarded-ad
   *  completion, so the dev-only math route always settles at the standard ×2. */
  const paidMultiplier = grantSource === "ad" ? multiplier : STANDARD_REWARD_MULTIPLIER;

  const doublingAvailable = remainingDoubles === undefined || remainingDoubles > 0;
  const adAvailable = isRewardedAdAvailable();
  const mathFallbackEnabled = isMathFallbackEnabled();
  // Whether any route to the double actually exists right now - drives the headline so
  // we never ask "double it?" when nothing can deliver it.
  const canAttemptDouble = doublingAvailable && (adAvailable || mathFallbackEnabled);
  // No ad, and no dev math route: say so quietly rather than offering a dead button.
  const showNoAdNotice = doublingAvailable && (adUnavailableNotice || (!adAvailable && !mathFallbackEnabled));
  // Was there a REAL double on the table that leaving now gives up? Only a watchable
  // rewarded ad counts: not the dev math route (which must never touch production
  // nudge semantics), not a used-up daily cap, and not an offer whose ad attempt has
  // already failed - that player tried, they did not refuse. Drives the skip streak
  // only; the reward_skipped event keeps firing exactly as it always has.
  const skipForfeitsRealDouble = doublingAvailable && adAvailable && !adUnavailableNotice;

  // Android-only offer nudges. False on web (and any non-Android platform), where
  // every branch below falls back to exactly what shipped before.
  const [nudgesEnabled] = useState(() => areRewardNudgesEnabled());

  // First-time explainer, gated on `adAvailable` - the STABLE capability check
  // (format flags + remote kill switch + consent + a registered adapter + a
  // configured ad unit), NOT isRewardedAdReady(), which only says whether an ad
  // happens to be preloaded right now and flips constantly. So the text never
  // promises an ad the platform cannot serve: Android yes, web no today, and the
  // moment H5 is merged and configured the same code lights up on the web.
  //
  // Only "was it still unseen?" is frozen at mount. Visibility itself is DERIVED
  // from the same fresh `adAvailable` the Watch Ad button uses, because ad setup is
  // asynchronous (consent -> SDK init -> registerAdAdapter) and nothing notifies
  // React when it finishes: an offer opened seconds after launch - the daily chest
  // is reachable that fast - can render while availability is still false and then
  // re-render true. Freezing this at mount would show the button with no
  // explanation. Tying both to one value makes that impossible.
  const [tutorialPending] = useState(() => shouldShowDoubleRewardTutorial());
  const [reminderPending] = useState(() => shouldShowReminder());
  const showTutorial = adAvailable && tutorialPending;
  // The tutorial wins - never both at once - and the reminder is pointless when no
  // ad can be served, so it shares the same gate.
  const showReminder = adAvailable && !showTutorial && reminderPending;

  useEffect(() => {
    preloadRewardedAd(placement);
    // A ×3 round reports on its own event names so the two offer types can be compared
    // in the report; see the reward_bonus_* block in analyticsSchema.ts for why this is
    // a separate name rather than a param. Same funnel, same placement, either way.
    trackEvent(isBonusRound ? "reward_bonus_offer_shown" : "reward_offer_shown", { placement });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marked and counted only once the text is genuinely on screen - which may be a
  // later render than the first, if ad setup finished after this offer opened. The
  // refs keep that to exactly one mark/event even if availability flickers.
  const tutorialLoggedRef = useRef(false);
  useEffect(() => {
    if (!showTutorial || tutorialLoggedRef.current) return;
    tutorialLoggedRef.current = true;
    markDoubleRewardTutorialShown();
    trackEvent("reward_double_tutorial_shown", { placement });
  }, [showTutorial, placement]);

  // One short celebratory flourish the first time the bonus is actually on screen.
  // Same ref-guard shape as the logging effects below, so a re-render (or StrictMode
  // remounting effects) can't retrigger it. playAchievementUnlockedSound() already
  // returns immediately when sound effects are switched off, so the setting is
  // honoured without a second check here.
  const bonusSoundedRef = useRef(false);
  useEffect(() => {
    if (!isBonusRound || phase !== "offer" || bonusSoundedRef.current) return;
    bonusSoundedRef.current = true;
    playAchievementUnlockedSound();
  }, [isBonusRound, phase]);

  const reminderLoggedRef = useRef(false);
  useEffect(() => {
    if (!showReminder || reminderLoggedRef.current) return;
    reminderLoggedRef.current = true;
    markReminderShown();
    trackEvent("reward_reminder_shown", { placement });
  }, [showReminder, placement]);

  function handleSkip() {
    playSelectSound();
    recordOfferSkipped(skipForfeitsRealDouble);
    // Walking away from a bonus offer that had a real ad behind it spends it; walking
    // away from one whose ad could not be served does not - `skipForfeitsRealDouble`
    // already draws exactly that line for the skip-streak nudge.
    resolveBonusRewardRound({ wasBonusRound: isBonusRound, granted: false, forfeitedRealOffer: skipForfeitsRealDouble });
    trackEvent(isBonusRound ? "reward_bonus_skipped" : "reward_skipped", { placement });
    onResolved(amount, anchorRef.current);
  }

  function handleChooseDouble() {
    playChipSound();
    trackEvent("reward_fallback_used", { placement });
    setPhase("quiz");
  }

  async function handleWatchAd() {
    playChipSound();
    trackEvent(isBonusRound ? "reward_bonus_ad_started" : "reward_ad_started", { placement });
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
      // The player did the thing the nudge was for - the skip streak starts over.
      recordRewardGranted();
      trackEvent(isBonusRound ? "reward_bonus_ad_completed" : "reward_ad_completed", { placement });
    } else {
      trackEvent(isBonusRound ? "reward_bonus_ad_failed" : "reward_ad_failed", { placement });
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
    const granted = wasCorrect && grantSource === "ad";
    resolveBonusRewardRound({ wasBonusRound: isBonusRound, granted, forfeitedRealOffer: false });
    onResolved(wasCorrect ? amount * paidMultiplier : amount, anchorRef.current);
  }

  return (
    <div ref={anchorRef} className={isBonusRound ? "double-offer-banner double-offer-banner-bonus" : "double-offer-banner"}>
      {phase === "offer" && (
        <>
          {/* Replaces the ×2 framing outright on a bonus round - inline in the existing
              banner, never a modal or popup over the screen. */}
          {isBonusRound && canAttemptDouble && <p className="double-offer-bonus-badge">✨ 3× BONUS!</p>}
          {/* Android only: spell out the concrete before/after amounts, both derived
              from the real `amount` prop - never hard-coded. `nudgesEnabled` is false
              on web, so the website always renders the original line. */}
          {nudgesEnabled && canAttemptDouble ? (
            <p className="double-offer-headline">
              🪙 You earned {amount} coins - watch an ad to get {amount * multiplier}
            </p>
          ) : (
            <p className="double-offer-headline">
              {canAttemptDouble
                ? `🪙 +${amount} coins - ${isBonusRound ? "triple it?" : "double it?"}`
                : `🪙 +${amount} coins`}
            </p>
          )}
          {showTutorial && (
            <p className="double-offer-limit-note">
              Watch a short ad to get {multiplier}× coins - completely optional.
            </p>
          )}
          {showReminder && (
            <p className="double-offer-limit-note">
              Tip: one short ad {isBonusRound ? "triples" : "doubles"} your coins.
            </p>
          )}
          {remainingDoubles !== undefined && (
            <p className="double-offer-limit-note">
              Chest doubles left today: {remainingDoubles}/{MAX_PAID_CHEST_DOUBLES_PER_DAY}
            </p>
          )}
          {showNoAdNotice && <p className="double-offer-limit-note">Ads aren’t available right now.</p>}
          <div className="double-offer-buttons">
            {doublingAvailable && adAvailable && (
              <button type="button" className="double-offer-double double-offer-ad-primary" onClick={handleWatchAd} disabled={adPending}>
                {adPending ? "Loading ad…" : isBonusRound ? "🎬 Watch Ad for 3×" : "🎬 Watch Ad to Double"}
              </button>
            )}
            {/* Dev-only: never rendered in a user-facing build (see isMathFallbackEnabled). */}
            {doublingAvailable && mathFallbackEnabled && (
              <button type="button" className="double-offer-double" onClick={handleChooseDouble} disabled={adPending}>
                🧮 Solve Math (dev)
              </button>
            )}
            {/* On Android the skip button names what it keeps; the web keeps the plain
                "Skip". Skipping stays exactly as easy either way - same button, same place. */}
            <button type="button" className="double-offer-skip" onClick={handleSkip} disabled={adPending}>
              {!canAttemptDouble ? "Continue" : nudgesEnabled ? `Keep ${amount}` : "Skip"}
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
          {wasCorrect && grantSource === "ad" && isBonusRound ? (
            <p className="double-offer-headline">✨ 3× BONUS! You tripled your coins: 🪙 +{amount * paidMultiplier}</p>
          ) : wasCorrect && grantSource === "ad" ? (
            <p className="double-offer-headline">✅ Ad watched! You doubled your coins: 🪙 +{amount * paidMultiplier}</p>
          ) : wasCorrect ? (
            <p className="double-offer-headline">✅ Correct! You doubled your coins: 🪙 +{amount * paidMultiplier}</p>
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
