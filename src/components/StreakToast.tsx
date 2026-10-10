import { useEffect, useState } from "react";
import { onStreakDayCompleted, type StreakDayEventDetail } from "../services/drawingStreakStore";
import StreakFlame from "./StreakFlame";

const SHOW_MS = 3600;

/**
 * The quiet "today counts" moment for modes without a streak line of their own - Multiplayer, 2 Players, Special,
 * Mega, Artist Pack and custom challenges. One short, non-blocking toast when the day completes (it never takes
 * focus, never needs a tap). Classic and the Daily show the day on their result screens instead, so they never get
 * a toast as well.
 */
export default function StreakToast() {
  const [day, setDay] = useState<StreakDayEventDetail | null>(null);
  useEffect(
    () =>
      onStreakDayCompleted((detail) => {
        if (detail.route === "classic" || detail.route === "daily") return;
        setDay(detail);
      }),
    [],
  );
  useEffect(() => {
    if (!day) return;
    const t = window.setTimeout(() => setDay(null), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [day]);

  if (!day) return null;
  const c = day.completion;
  return (
    <div className="streak-toast" role="status">
      <StreakFlame lit size={20} />
      <span>{c.restartedFrom > 0 ? `New streak · Day 1` : `Day ${c.day} · today counts`}</span>
      <span className="streak-toast-coins">+{c.coins} 🪙</span>
    </div>
  );
}
