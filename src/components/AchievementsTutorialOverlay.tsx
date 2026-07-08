import { useEffect, useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";

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
  const dialogRef = useDialogA11y<HTMLDivElement>(rect !== null, { onClose: onDismiss });

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
    <div
      ref={dialogRef}
      className="tutorial-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Achievements tutorial"
      onClick={onDismiss}
    >
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
