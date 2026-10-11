import { useState } from "react";
import { STREAK_MILESTONES, streakRewardFor, type StreakView } from "../app/drawingStreak";
import { playSelectSound } from "../engine/soundEngine";
import { useStreakView } from "../hooks/useStreakView";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

function subLine(v: StreakView): string {
  const progress = `${Math.min(v.drawings, v.target)}/${v.target} drawings today`;
  switch (v.status) {
    case "done":
      return `Today ✓ · tomorrow +${streakRewardFor(v.current + 1)} 🪙`;
    case "restarted":
      return "New streak · today ✓";
    case "at_risk":
      return "At risk · tap for options";
    case "protected":
      return `🛡 Protected · ${progress}`;
    case "rescued":
      return `Rescued ✓ · ${progress}`;
    default:
      return `${progress} · any mode`;
  }
}

/**
 * Home's single streak indicator (Android and web): the streak and its state, today's progress toward 5 drawings in
 * any mode, and the next milestone - one compact line that opens the streak view. Same status as every other
 * streak surface (app/drawingStreak.ts viewStreak), so Home and the sheet can never disagree.
 */
export default function StreakStrip() {
  const view = useStreakView();
  const [open, setOpen] = useState(false);

  const next = STREAK_MILESTONES.find((m) => m.day > view.current);
  const title = view.current > 0 ? `${view.current}-day streak` : "Start a drawing streak";
  const sub = subLine(view);
  const risk = view.status === "at_risk";

  return (
    <>
      <button
        type="button"
        className={`streak-strip${view.doneToday ? " streak-strip-done" : ""}${risk ? " streak-strip-risk" : ""}`}
        onClick={() => {
          playSelectSound();
          setOpen(true);
        }}
        aria-label={`${title}. ${sub.replace("🪙", "coins")}. Show streak`}
      >
        <span className="streak-strip-flame">
          <StreakFlame lit={view.doneToday} size={26} />
        </span>
        <span className="streak-strip-text">
          <span className="streak-strip-title">{title}</span>
          <span className="streak-strip-sub">{sub}</span>
        </span>
        {view.doneToday || risk ? (
          next && (
            <span className="streak-strip-next" aria-hidden="true">
              Day {next.day}
              <br />+{next.coins} 🪙
            </span>
          )
        ) : (
          <span className="daily-goal-dots streak-strip-dots" aria-hidden="true">
            {Array.from({ length: view.target }, (_, i) => (
              <span key={i} className={i < view.drawings ? "daily-goal-dot daily-goal-dot-on" : "daily-goal-dot"} />
            ))}
          </span>
        )}
      </button>
      {open && <StreakSheet onClose={() => setOpen(false)} />}
    </>
  );
}
