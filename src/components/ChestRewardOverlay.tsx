import { useEffect, useRef, useState } from "react";
import { rollChestReward } from "../app/constants";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playAchievementUnlockedSound } from "../engine/soundEngine";
import { addCoins } from "../services/coinsStore";
import { getPaidChestDoublesRemaining, recordPaidChestDoubleUsed } from "../services/chestDoubleLimitStore";
import DoubleCoinsOffer from "./DoubleCoinsOffer";

type ChestRewardOverlayProps = {
  chestName: string;
  chestIcon: string;
  /** e.g. "chest-reward-card-wood" | "chest-reward-card-iron" | ... - picks the tier's color gradient. */
  tierClassName: string;
  /** The reward already rolled for this chest - revealed at the end of the spin animation below. */
  amount: number;
  /** The tier's full reward range, used only to make the spin animation cycle through plausible-looking numbers. */
  rewardMin: number;
  rewardMax: number;
  /** Whether this chest was bought via the shop rather than the once-a-day free Daily Chest - paid chests are subject to the daily double-reward cap, the free chest is not. */
  isPaidChest: boolean;
  /** Called once the whole reveal (including any double-or-nothing decision) is done - coins are already credited by then. */
  onDismissed: () => void;
};

type Phase = "opening" | "spinning" | "revealed";

const OPENING_MS = 500;
const SPIN_STEPS = 10;
const SPIN_MIN_INTERVAL_MS = 55;
const SPIN_MAX_INTERVAL_MS = 220;

/**
 * Full-screen reveal for a just-opened chest (free daily chest or a purchased key): the
 * chest pops open with a fanfare, a short reward-spinner ticks through numbers across the
 * tier's range, then settles on the actual amount and credits it. A double-or-nothing offer
 * is folded in afterward as a bonus chance, on top of the already-credited base reward.
 */
export default function ChestRewardOverlay({
  chestName,
  chestIcon,
  tierClassName,
  amount,
  rewardMin,
  rewardMax,
  isPaidChest,
  onDismissed,
}: ChestRewardOverlayProps) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [spinAmount, setSpinAmount] = useState(amount);
  const [remainingDoubles] = useState(() => (isPaidChest ? getPaidChestDoublesRemaining() : undefined));
  const amountRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      playAchievementUnlockedSound();
      setPhase("spinning");
    }, OPENING_MS);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (phase !== "spinning") return;
    let step = 0;
    let timeoutId: number;
    function tick() {
      step++;
      if (step >= SPIN_STEPS) {
        setSpinAmount(amount);
        setPhase("revealed");
        return;
      }
      setSpinAmount(rollChestReward(rewardMin, rewardMax));
      const progress = step / SPIN_STEPS;
      const interval = SPIN_MIN_INTERVAL_MS + (SPIN_MAX_INTERVAL_MS - SPIN_MIN_INTERVAL_MS) * progress ** 2;
      timeoutId = window.setTimeout(tick, interval);
    }
    timeoutId = window.setTimeout(tick, SPIN_MIN_INTERVAL_MS);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealed") return;
    addCoins(amount);
    triggerCoinFlight(amountRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleDoubleResolved(finalAmount: number, anchorEl: HTMLElement | null) {
    // The base `amount` is already credited above - only the extra half of a successful double is new.
    if (finalAmount > amount) addCoins(finalAmount - amount);
    triggerCoinFlight(anchorEl);
    onDismissed();
  }

  return (
    <div className="chest-reward-overlay">
      <div className={`chest-reward-card ${tierClassName}`}>
        <span className={phase === "opening" ? "chest-reward-icon chest-reward-icon-opening" : "chest-reward-icon"} aria-hidden="true">
          {chestIcon}
        </span>
        <span className="chest-reward-headline">{phase === "opening" ? "Opening..." : `${chestName} opened!`}</span>
        {phase !== "opening" && (
          <span ref={amountRef} className={phase === "spinning" ? "chest-reward-amount chest-reward-amount-spinning" : "chest-reward-amount"}>
            🪙 +{phase === "spinning" ? spinAmount : amount}
          </span>
        )}
        {phase === "revealed" && (
          <DoubleCoinsOffer
            amount={amount}
            onResolved={handleDoubleResolved}
            remainingDoubles={remainingDoubles}
            onDoubleAttempted={isPaidChest ? recordPaidChestDoubleUsed : undefined}
          />
        )}
      </div>
    </div>
  );
}
