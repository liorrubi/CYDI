import { useEffect, useRef } from "react";
import { DAILY_GOAL_COINS } from "../app/constants";
import { triggerCoinFlight } from "../engine/coinFlight";

type DailyGoalChipProps = { games: number; target: number; justCompleted: boolean };

/**
 * The optional daily goal's discreet progress on the Classic result ("3/5"), and the one-line "+20" on the game that
 * completes it. Never shown again that day once paid - it is a nudge, not a banner.
 */
export default function DailyGoalChip({ games, target, justCompleted }: DailyGoalChipProps) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (!justCompleted) return;
    const t = window.setTimeout(() => triggerCoinFlight(ref.current), 250);
    return () => window.clearTimeout(t);
  }, [justCompleted]);

  const shown = Math.min(games, target);
  return (
    <p ref={ref} className={`daily-goal-chip${justCompleted ? " daily-goal-chip-done" : ""}`} aria-live="polite">
      <span className="daily-goal-dots" aria-hidden="true">
        {Array.from({ length: target }, (_, i) => (
          <span key={i} className={i < shown ? "daily-goal-dot daily-goal-dot-on" : "daily-goal-dot"} />
        ))}
      </span>
      {justCompleted ? (
        <span>Daily goal done · +{DAILY_GOAL_COINS} 🪙</span>
      ) : (
        <span>
          Daily goal {shown}/{target} · +{DAILY_GOAL_COINS} 🪙
        </span>
      )}
    </p>
  );
}
