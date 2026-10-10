import { useEffect, useState } from "react";
import { STREAK_MILESTONES, streakRewardFor } from "../app/drawingStreak";
import { playSelectSound } from "../engine/soundEngine";
import { getStreakView, onStreakChanged } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

/**
 * Home's single streak indicator (Android and web): the streak, today's progress toward it in any mode, and the next
 * reward - one compact line that opens the streak view. It replaces the Daily-only presentation: whichever mode the
 * player prefers, this is where the streak lives.
 */
export default function StreakStrip() {
  const [view, setView] = useState(() => getStreakView());
  const [open, setOpen] = useState(false);
  useEffect(() => onStreakChanged(() => setView(getStreakView())), []);

  const count = view.current > 0 ? view.current : view.atRisk;
  const next = STREAK_MILESTONES.find((m) => m.day > count);
  const title = view.atRisk > 0 ? `${view.atRisk}-day streak at risk` : count > 0 ? `${count}-day streak` : "Start a drawing streak";
  const sub = view.doneToday
    ? `Today ✓ · tomorrow +${streakRewardFor(view.current + 1)} 🪙`
    : view.atRisk > 0
      ? "Missed a day · tap to keep it"
      : `${Math.min(view.drawings, view.target)}/${view.target} drawings · or the Daily`;

  return (
    <>
      <button
        type="button"
        className={`streak-strip${view.doneToday ? " streak-strip-done" : ""}${view.atRisk > 0 ? " streak-strip-risk" : ""}`}
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
        {view.doneToday || view.atRisk > 0 ? (
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
