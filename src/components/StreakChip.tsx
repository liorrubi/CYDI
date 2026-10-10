import { useEffect, useState } from "react";
import { playSelectSound } from "../engine/soundEngine";
import { getStreakView, onStreakChanged } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

/**
 * The small streak indicator beside the player's name on the Daily screen: flame + day count (an at-risk streak shows
 * its count in amber). Tapping it opens the streak view on demand - nothing about the streak occupies the screen
 * otherwise.
 */
export default function StreakChip() {
  const [view, setView] = useState(() => getStreakView());
  const [open, setOpen] = useState(false);
  useEffect(() => onStreakChanged(() => setView(getStreakView())), []);

  const count = view.current > 0 ? view.current : view.atRisk;
  const label =
    view.atRisk > 0
      ? `Drawing streak: ${view.atRisk} days, at risk. Show streak`
      : view.current > 0
        ? `Drawing streak: ${view.current} ${view.current === 1 ? "day" : "days"}${view.doneToday ? ", today counts" : ""}. Show streak`
        : "Drawing streak: not started. Show streak";
  return (
    <>
      <button
        type="button"
        className={`streak-chip${view.doneToday ? " streak-chip-lit" : ""}${view.atRisk > 0 ? " streak-chip-risk" : ""}`}
        onClick={() => {
          playSelectSound();
          setOpen(true);
        }}
        aria-label={label}
      >
        <StreakFlame lit={view.doneToday} size={15} />
        <span className="streak-chip-count">{count}</span>
      </button>
      {open && <StreakSheet onClose={() => setOpen(false)} />}
    </>
  );
}
