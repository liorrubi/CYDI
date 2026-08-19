import { useEffect, useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";

type OnboardingTutorialOverlayProps = {
  /** The player accepted the invitation - go start the first Shape Challenge round. */
  onStart: () => void;
  onDismiss: () => void;
};

/**
 * The new-player welcome: a single "Start here" spotlight on the Shape Challenge
 * card of the home screen, not a step-by-step modal. Everything else the old
 * 5-step tour explained (Daily, Create, coins) is taught contextually by its own
 * existing tutorial the first time the player actually meets it.
 *
 * Same coach-mark pattern as AchievementsTutorialOverlay: dim the screen and
 * spotlight the live element wherever it currently sits in the DOM.
 */
export default function OnboardingTutorialOverlay({ onStart, onDismiss }: OnboardingTutorialOverlayProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>(rect !== null, { onClose: onDismiss });

  useEffect(() => {
    function measure() {
      const el = document.querySelector<HTMLElement>(".home-card-featured");
      if (el) setRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (!rect) return null;

  function handleStart(event: React.MouseEvent) {
    event.stopPropagation();
    onStart();
  }

  return (
    <div
      ref={dialogRef}
      className="tutorial-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Start here: Shape Challenge"
      onClick={onDismiss}
    >
      <button
        type="button"
        className="tutorial-spotlight-card"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        onClick={handleStart}
      >
        <span className="tutorial-spotlight-card-title">Shape Challenge</span>
        <span className="tutorial-spotlight-card-sub">Draw what the game shows you</span>
      </button>
      <div className="tutorial-tooltip" style={{ left: rect.left + rect.width / 2, top: rect.bottom + 12 }} onClick={handleStart}>
        👆 Start here — draw your first shape!
      </div>
    </div>
  );
}
