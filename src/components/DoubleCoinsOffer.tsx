import { useRef, useState } from "react";
import { playChipSound, playCoinsSound, playDangerSound, playSelectSound, playSuccessSound } from "../engine/soundEngine";
import { MAX_PAID_CHEST_DOUBLES_PER_DAY } from "../services/chestDoubleLimitStore";

type DoubleCoinsOfferProps = {
  /** The coin reward already earned and guaranteed - doubling only ever adds on top of this, never takes it away. */
  amount: number;
  /** Called once the player's decision is final, with the coin total to actually credit and the element to fly the coin animation from. */
  onResolved: (finalAmount: number, anchorEl: HTMLElement | null) => void;
  /** Remaining doubles under a daily cap (paid shop chests) - omit for unlimited (Daily Chest, challenge rewards). When 0, the double option is hidden and only the base reward can be collected. */
  remainingDoubles?: number;
  /** Called once, when the player commits to attempting a double (before the quiz) - lets the caller record the attempt against its daily cap. Only meaningful alongside `remainingDoubles`. */
  onDoubleAttempted?: () => void;
};

type Phase = "offer" | "quiz" | "feedback";

function randomFactor(): number {
  return 1 + Math.floor(Math.random() * 10);
}

/**
 * Flashing "double or nothing" offer shown after a coin reward. Skipping keeps the
 * original amount unchanged; choosing to double requires answering a random
 * multiplication-table question (product always <= 100). A correct answer doubles the
 * reward, a wrong one keeps the original amount - the player can never end up with less
 * than they already earned. Once the game ships to app stores, this quiz step is meant
 * to be swapped for a rewarded video ad, but that's not built yet.
 *
 * Callers with a daily cap (paid shop chests) pass `remainingDoubles` and `onDoubleAttempted`;
 * once the cap is hit, the double option disappears and only the base reward remains
 * collectible, with the current count shown to the player.
 */
export default function DoubleCoinsOffer({ amount, onResolved, remainingDoubles, onDoubleAttempted }: DoubleCoinsOfferProps) {
  const [phase, setPhase] = useState<Phase>("offer");
  const [question] = useState(() => ({ a: randomFactor(), b: randomFactor() }));
  const [answer, setAnswer] = useState("");
  const [wasCorrect, setWasCorrect] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const doublingAvailable = remainingDoubles === undefined || remainingDoubles > 0;

  function handleSkip() {
    playSelectSound();
    onResolved(amount, anchorRef.current);
  }

  function handleChooseDouble() {
    playChipSound();
    onDoubleAttempted?.();
    setPhase("quiz");
  }

  function handleSubmitAnswer(e: React.FormEvent) {
    e.preventDefault();
    const correct = Number(answer) === question.a * question.b;
    setWasCorrect(correct);
    setPhase("feedback");
    if (correct) {
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
            {doublingAvailable ? `🪙 +${amount} coins - double it?` : `🪙 +${amount} coins`}
          </p>
          {remainingDoubles !== undefined && (
            <p className="double-offer-limit-note">
              Chest doubles left today: {remainingDoubles}/{MAX_PAID_CHEST_DOUBLES_PER_DAY}
            </p>
          )}
          <div className="double-offer-buttons">
            {doublingAvailable && (
              <button type="button" className="double-offer-double" onClick={handleChooseDouble}>
                ✖️2 Double
              </button>
            )}
            <button type="button" className="double-offer-skip" onClick={handleSkip}>
              {doublingAvailable ? "Skip" : "Continue"}
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
              type="number"
              inputMode="numeric"
              autoFocus
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
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
          {wasCorrect ? (
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
