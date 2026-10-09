import { useEffect, useState } from "react";
import { playSelectSound } from "../engine/soundEngine";
import { getStreakView, onStreakChanged } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";
import StreakSheet from "./StreakSheet";

/**
 * The small, always-available streak indicator (Daily screen): flame + day count. Tapping it opens the streak view
 * on demand - nothing about the streak occupies the screen otherwise.
 */
export default function StreakChip() {
  const [view, setView] = useState(() => getStreakView());
  const [open, setOpen] = useState(false);
  useEffect(() => onStreakChanged(() => setView(getStreakView())), []);

  const label =
    view.current > 0
      ? `Daily streak: ${view.current} ${view.current === 1 ? "day" : "days"}${view.doneToday ? ", done today" : ""}. Show streak`
      : "Daily streak: not started. Show streak";
  return (
    <>
      <button
        type="button"
        className={`streak-chip${view.doneToday ? " streak-chip-lit" : ""}`}
        onClick={() => {
          playSelectSound();
          setOpen(true);
        }}
        aria-label={label}
      >
        <StreakFlame lit={view.doneToday} size={18} />
        <span className="streak-chip-count">{view.current}</span>
      </button>
      {open && <StreakSheet onClose={() => setOpen(false)} />}
    </>
  );
}
