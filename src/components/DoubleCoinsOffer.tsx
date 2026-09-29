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
import type { RewardOfferEconomy } from "../services/analyticsSchema";
import { rewardOfferContext } from "../services/economyAnalytics";
import { markDoubleRewardTutorialShown, shouldShowDoubleRewardTutorial } from "../services/tutorialStore";
import { consumesDoubleAttempt, resolveAdOutcome } from "./doubleOfferAdFlow";
import { createOfferSettlement } from "../app/doubleOfferSettlement";
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
import {
  PLUS_BONUS_COINS,
  rewardedFinalAmount,
  setRewardedContinuation,
  type RewardedArm,
  type RewardedOutcome,
} from "../app/rewardedOfferCadence";

/** Rewarded Ads Experiment v1 context for the Classic result offer (src/app/rewardedOfferCadence.ts). */
export type RewardedExperimentOffer = { arm: RewardedArm; offerNumber: number; sessionGames: number };

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
  /** True while the screen is running a higher-priority coach hint (the first-round "Tap Next"). Hides the one-time ×2 explainer and reminder WITHOUT burning their flags - they simply return on a later, quieter offer. The offer itself stays fully usable. */
  deferExplainer?: boolean;
  /**
   * Called the moment the double is EARNED (the SDK's confirmed reward, or the dev-only
   * quiz answered correctly), with a function that settles it exactly as Continue does.
   * A screen that can be left without pressing Continue (Next Shape, Try Again, Back to
   * Map) calls it on the way out, so an earned bonus is never forfeited. Settling is
   * once-only: Continue and the exit path can never both credit.
   */
  onRewardEarned?: (finalize: () => void) => void;
  /**
   * Called once on mount with a function that records a skip exactly as this offer's own
   * Skip button would - right event name for a ×3 round, same economy context. A screen
   * whose exit forfeits the offer calls it instead of emitting its own event.
   */
  onSkipReporter?: (report: () => void) => void;
  /**
   * Rewarded Ads Experiment v1 (Classic result offer only). When set, the offer is worth the
   * arm's value - "x3" triples the coins, "plus100" adds a flat 100 - instead of the ×2 /
   * periodic ×3, the funnel events carry the experiment context, and the offer's outcome
   * feeds reward_continuation. Everything else (layout, buttons, availability) is identical
   * for both arms.
   */
  experiment?: RewardedExperimentOffer;
  /** Called once, when the offer is genuinely on screen (same moment as its offer_shown event). */
  onShown?: () => void;
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
export function isMathFallbackEnabled(): boolean {
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
export default function DoubleCoinsOffer({ amount, onResolved, placement, remainingDoubles, onDoubleAttempted, deferExplainer = false, onRewardEarned, onSkipReporter, experiment, onShown }: DoubleCoinsOfferProps) {
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
  // The experiment replaces the periodic ×3 on the offer it drives - never both.
  const [isBonusRound] = useState(() => !experiment && isBonusRewardRound(placement));
  // One settlement per offer, shared by Continue and any exit path (onRewardEarned).
  // onResolved is read through a ref so a settlement triggered from the screen's exit
  // handler still reaches the screen's latest callback.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const [settlement] = useState(() =>
    createOfferSettlement(isBonusRound, {
      resolveBonusRewardRound,
      onResolved: (finalAmount, anchorEl) => onResolvedRef.current(finalAmount, anchorEl),
    }),
  );
  /** What this offer advertises: 3 on a bonus round, otherwise the usual 2. */
  const multiplier = rewardMultiplier(isBonusRound);
  /** Experiment arms: "x3" -> the round's coins x3, "plus100" -> the round's coins + 100. */
  const isX3Arm = experiment?.arm === "x3";
  /** The total a confirmed rewarded-ad completion pays. */
  const adFinalAmount = experiment ? rewardedFinalAmount(experiment.arm, amount) : amount * multiplier;
  /** What actually gets PAID. The 3× is reserved for a confirmed rewarded-ad
   *  completion, so the dev-only math route always settles at the standard ×2
   *  (for an experiment offer it mirrors the arm, so the dev flow shows the real value). */
  const paidAmount = grantSource === "ad" || experiment ? adFinalAmount : amount * STANDARD_REWARD_MULTIPLIER;

  // Experiment only: the offer's final outcome, for the next game_started's reward_continuation.
  // completed beats failed beats skipped, so a skip after a failed ad still reads as "tried".
  const outcomeRef = useRef<RewardedOutcome | null>(null);
  const recordOutcome = (outcome: RewardedOutcome) => {
    if (!experiment) return;
    const rank: Record<RewardedOutcome, number> = { skipped: 0, failed: 1, completed: 2 };
    if (outcomeRef.current && rank[outcomeRef.current] >= rank[outcome]) return;
    outcomeRef.current = outcome;
    setRewardedContinuation(experiment.arm, experiment.offerNumber, outcome);
  };

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
  const showTutorial = adAvailable && tutorialPending && !deferExplainer;
  // The tutorial wins - never both at once - and the reminder is pointless when no
  // ad can be served, so it shares the same gate.
  const showReminder = adAvailable && !showTutorial && reminderPending && !deferExplainer;

  // Economy context for every funnel event of THIS offer (economyAnalytics.ts): computed
  // once, one tick after mount - a parent can credit the base reward in its own mount
  // effect, which React runs after this child's - so the balance bucket always includes
  // the coins just earned. adAvailable is the capability at that moment, which is what
  // separates "an offer with no ad behind it" from a real one.
  const economyRef = useRef<RewardOfferEconomy | null>(null);
  const funnelParams = () => {
    if (!economyRef.current) {
      economyRef.current = experiment
        ? rewardOfferContext(amount, isX3Arm ? 3 : 1, isRewardedAdAvailable(), adFinalAmount - amount)
        : rewardOfferContext(amount, multiplier as 2 | 3, isRewardedAdAvailable());
    }
    if (!economyRef.current) return { placement };
    if (!experiment) return { placement, ...economyRef.current };
    return {
      placement,
      ...economyRef.current,
      arm: experiment.arm,
      offerNumber: experiment.offerNumber,
      sessionGames: experiment.sessionGames,
      bonusCoins: adFinalAmount - amount,
    };
  };

  useEffect(() => {
    preloadRewardedAd(placement);
    onSkipReporter?.(() => {
      recordOutcome("skipped");
      trackEvent(isBonusRound ? "reward_bonus_skipped" : "reward_skipped", funnelParams());
    });
    // A ×3 round reports on its own event names so the two offer types can be compared
    // in the report; see the reward_bonus_* block in analyticsSchema.ts for why this is
    // a separate name rather than a param. Same funnel, same placement, either way.
    // onShown fires in the same tick as offer_shown: this is the moment the offer counts
    // as rendered (once - the timeout is cleared if StrictMode re-runs the effect).
    const t = window.setTimeout(() => {
      trackEvent(isBonusRound ? "reward_bonus_offer_shown" : "reward_offer_shown", funnelParams());
      onShown?.();
    }, 0);
    return () => window.clearTimeout(t);
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
    recordOutcome("skipped");
    trackEvent(isBonusRound ? "reward_bonus_skipped" : "reward_skipped", funnelParams());
    onResolved(amount, anchorRef.current);
  }

  function handleChooseDouble() {
    playChipSound();
    trackEvent("reward_fallback_used", { placement });
    setPhase("quiz");
  }

  async function handleWatchAd() {
    playChipSound();
    trackEvent(isBonusRound ? "reward_bonus_ad_started" : "reward_ad_started", funnelParams());
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
      recordOutcome("completed");
      trackEvent(isBonusRound ? "reward_bonus_ad_completed" : "reward_ad_completed", funnelParams());
      const finalAmount = adFinalAmount;
      onRewardEarned?.(() => settlement.settle({ granted: true, finalAmount }, anchorRef.current));
    } else {
      recordOutcome("failed");
      trackEvent(isBonusRound ? "reward_bonus_ad_failed" : "reward_ad_failed", funnelParams());
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
      const finalAmount = experiment ? adFinalAmount : amount * STANDARD_REWARD_MULTIPLIER;
      onRewardEarned?.(() => settlement.settle({ granted: false, finalAmount }, anchorRef.current));
    } else {
      playDangerSound();
    }
  }

  function handleContinue() {
    const granted = wasCorrect && grantSource === "ad";
    settlement.settle({ granted, finalAmount: wasCorrect ? paidAmount : amount }, anchorRef.current);
  }

  // Copy. The experiment arms share every string's shape; only the value differs.
  const offerQuestion = experiment ? (isX3Arm ? "triple it?" : `get +${PLUS_BONUS_COINS} more?`) : isBonusRound ? "triple it?" : "double it?";
  const watchLabel = experiment ? (isX3Arm ? "🎬 Watch Ad for 3×" : `🎬 Watch Ad for +${PLUS_BONUS_COINS}`) : isBonusRound ? "🎬 Watch Ad for 3×" : "🎬 Watch Ad to Double";
  const tutorialValue = experiment ? (isX3Arm ? "3× coins" : `+${PLUS_BONUS_COINS} coins`) : `${multiplier}× coins`;
  const reminderText = experiment ? (isX3Arm ? "triples your coins" : `adds ${PLUS_BONUS_COINS} coins`) : `${isBonusRound ? "triples" : "doubles"} your coins`;

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
              🪙 You earned {amount} coins - watch an ad to get {adFinalAmount}
            </p>
          ) : (
            <p className="double-offer-headline">
              {canAttemptDouble
                ? `🪙 +${amount} coins - ${offerQuestion}`
                : `🪙 +${amount} coins`}
            </p>
          )}
          {showTutorial && (
            <p className="double-offer-limit-note">
              Watch a short ad to get {tutorialValue} - completely optional.
            </p>
          )}
          {showReminder && (
            <p className="double-offer-limit-note">
              Tip: one short ad {reminderText}.
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
                {adPending ? "Loading ad…" : watchLabel}
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
          {wasCorrect && experiment ? (
            <p className="double-offer-headline">
              {isX3Arm ? "✅ Ad watched! You tripled your coins" : `✅ Ad watched! +${PLUS_BONUS_COINS} bonus coins`}: 🪙 +{paidAmount}
            </p>
          ) : wasCorrect && grantSource === "ad" && isBonusRound ? (
            <p className="double-offer-headline">✨ 3× BONUS! You tripled your coins: 🪙 +{paidAmount}</p>
          ) : wasCorrect && grantSource === "ad" ? (
            <p className="double-offer-headline">✅ Ad watched! You doubled your coins: 🪙 +{paidAmount}</p>
          ) : wasCorrect ? (
            <p className="double-offer-headline">✅ Correct! You doubled your coins: 🪙 +{paidAmount}</p>
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
