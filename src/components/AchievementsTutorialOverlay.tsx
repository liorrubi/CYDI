import { useEffect, useState } from "react";

type AchievementsTutorialOverlayProps = {
  onNavigateToAchievements: () => void;
  onDismiss: () => void;
};

/** A one-time coach mark: dims the screen and spotlights the achievements icon (wherever it currently sits in the DOM) with a tooltip pointing at it. */
export default function AchievementsTutorialOverlay({
  onNavigateToAchievements,
  onDismiss,
}: AchievementsTutorialOverlayProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    function measure() {
      const el = document.querySelector<HTMLElement>(".achievements-shortcut");
      if (el) setRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function handleIconClick(event: React.MouseEvent) {
    event.stopPropagation();
    onNavigateToAchievements();
  }

  if (!rect) return null;

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  return (
    <div className="tutorial-overlay" onClick={onDismiss}>
      <button
        type="button"
        className="tutorial-spotlight-icon"
        style={{ left: centerX, top: centerY }}
        onClick={handleIconClick}
        aria-label="Achievements"
      >
        🏆
      </button>
      <div className="tutorial-tooltip" style={{ left: centerX, top: rect.bottom + 16 }} onClick={handleIconClick}>
        Tap here to see your achievements and earn coins!
      </div>
    </div>
  );
}
