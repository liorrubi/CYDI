import { useEffect, useRef, useState } from "react";
import type { StreakCompletion } from "../app/drawingStreak";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playSelectSound } from "../engine/soundEngine";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

type StreakProgressChipProps = {
  drawings: number;
  target: number;
  /** The day this drawing completed (shown once, with its coins); null = progress only. */
  completion: StreakCompletion | null;
};

/**
 * The Drawing Streak's one line on a game result: today's progress ("2/5 today"), and on the drawing that completes
 * the day, the day reached and its coins. Never shown again that day once the day counts - a nudge, not a banner.
 * Tapping it opens the streak view (milestones, Saves, and a rescue when one is available).
 */
export default function StreakProgressChip({ drawings, target, completion }: StreakProgressChipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!completion) return;
    const t = window.setTimeout(() => triggerCoinFlight(ref.current), 250);
    return () => window.clearTimeout(t);
  }, [completion]);

  const shown = Math.min(drawings, target);
  const label = completion
    ? completion.restartedFrom > 0
      ? `New streak · Day 1 · +${completion.coins} 🪙`
      : `Day ${completion.day} streak · +${completion.coins} 🪙`
    : `Streak · ${shown}/${target} today`;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`daily-goal-chip streak-progress-chip${completion ? " daily-goal-chip-done streak-progress-chip-done" : ""}`}
        onClick={() => {
          playSelectSound();
          setOpen(true);
        }}
        aria-live="polite"
        aria-label={`${label.replace(" 🪙", " coins")}. Show streak`}
      >
        <StreakFlame lit={completion !== null} size={15} />
        {!completion && (
          <span className="daily-goal-dots" aria-hidden="true">
            {Array.from({ length: target }, (_, i) => (
              <span key={i} className={i < shown ? "daily-goal-dot daily-goal-dot-on" : "daily-goal-dot"} />
            ))}
          </span>
        )}
        <span>{label}</span>
      </button>
      {open && <StreakSheet onClose={() => setOpen(false)} />}
    </>
  );
}
