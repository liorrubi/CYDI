import { useState } from "react";
import type { StreakCompletion } from "../app/drawingStreak";
import { playSelectSound } from "../engine/soundEngine";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

type StreakProgressChipProps = {
  drawings: number;
  target: number;
  /** The day this drawing completed; null = progress only. */
  completion: StreakCompletion | null;
};

/**
 * The Drawing Streak's one line on a Classic or Daily result: today's progress ("Streak · 2/5 today"), and on the
 * drawing that makes the day count, "Day 4 ✓ · 5/5". The rewards themselves are shown once by the global
 * celebration (StreakCelebration), so this line never repeats them. Never shown again that day once the day counts.
 * Tapping it opens the streak view.
 */
export default function StreakProgressChip({ drawings, target, completion }: StreakProgressChipProps) {
  const [open, setOpen] = useState(false);
  const shown = Math.min(drawings, target);
  const label = completion ? `${completion.restartedFrom > 0 ? "New streak · " : ""}Day ${completion.day} ✓ · ${target}/${target}` : `Streak · ${shown}/${target} today`;
  return (
    <>
      <button
        type="button"
        className={`daily-goal-chip streak-progress-chip${completion ? " daily-goal-chip-done streak-progress-chip-done" : ""}`}
        onClick={() => {
          playSelectSound();
          setOpen(true);
        }}
        aria-live="polite"
        aria-label={`${completion ? `Today counts: day ${completion.day} of your streak` : `Streak: ${shown} of ${target} drawings today`}. Show streak`}
      >
        <StreakFlame lit={completion !== null} size={15} />
        <span className="daily-goal-dots" aria-hidden="true">
          {Array.from({ length: target }, (_, i) => (
            <span key={i} className={i < shown ? "daily-goal-dot daily-goal-dot-on" : "daily-goal-dot"} />
          ))}
        </span>
        <span>{label}</span>
      </button>
      {open && <StreakSheet onClose={() => setOpen(false)} />}
    </>
  );
}
