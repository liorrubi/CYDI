import { useEffect, useState } from "react";
import type { StreakView } from "../app/drawingStreak";
import { getStreakView, onStreakChanged } from "../services/drawingStreakStore";

/**
 * The Drawing Streak as it stands right now, for every streak surface (Home bar, Daily chip, sheet). Re-read after
 * every streak write, when the app comes back to the front, and once a minute - so an app left open across the
 * Israel midnight moves to the new day ("0/5 today", at risk, ...) without waiting for the next drawing.
 * Unchanged views keep their identity, so the minute tick re-renders nothing.
 */
export function useStreakView(): StreakView {
  const [view, setView] = useState(() => getStreakView());
  useEffect(() => {
    const refresh = () =>
      setView((prev) => {
        const next = getStreakView();
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
      });
    const offChange = onStreakChanged(refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      offChange();
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);
  return view;
}
