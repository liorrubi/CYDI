import type { CSSProperties } from "react";

type RoundTimerProps = {
  /** Milliseconds left, already corrected for clock skew by useDeadlineRemaining. */
  remainingMs: number | null;
  totalMs: number;
};

/**
 * When the bar and the number turn red.
 *
 * Five seconds of a 20-second window is the last quarter of the round - long
 * enough to be a real warning on a shape you have not finished, short enough
 * that it is not red for most of the time you are drawing.
 */
const URGENT_MS = 5_000;

/**
 * The drawing clock: a shrinking bar plus the seconds remaining.
 *
 * Both are driven from the value passed in, which is derived from an absolute
 * SERVER deadline rather than counted down locally - so a phone that froze in
 * the background resumes showing the true remaining time instead of a stale
 * count that has to catch up.
 */
export default function RoundTimer({ remainingMs, totalMs }: RoundTimerProps) {
  if (remainingMs === null) return null;

  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  const urgent = remainingMs <= URGENT_MS;

  return (
    <div className={urgent ? "mp-timer mp-timer-urgent" : "mp-timer"}>
      <div className="mp-timer-track">
        <div className="mp-timer-fill" style={{ "--mp-timer-fraction": fraction } as CSSProperties} />
      </div>
      {/*
        aria-live is off: an assertive per-second countdown would talk over
        everything else. The number stays readable, and the urgent styling
        carries the same signal visually.
      */}
      <span className="mp-timer-value" aria-label={`${seconds} seconds left`}>
        {seconds}s
      </span>
    </div>
  );
}
