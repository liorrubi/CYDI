import { useDialogA11y } from "../hooks/useDialogA11y";

type DrawingTutorialOverlayProps = {
  onDismiss: () => void;
};

/**
 * A short one-card walkthrough of the drawing controls, shown once the first time a new player
 * reaches any canvas. Reused as-is across all five drawing screens, so wording must hold true on
 * all of them - avoid mode-specific controls like Shape Challenge's "Show Guide" toggle or naming
 * a specific finish button ("Done" vs "Save Challenge").
 */
export default function DrawingTutorialOverlay({ onDismiss }: DrawingTutorialOverlayProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onDismiss });

  return (
    <div className="onboarding-overlay" role="presentation">
      <div ref={dialogRef} className="onboarding-card onboarding-accent-purple" role="dialog" aria-modal="true" aria-label="Drawing tutorial">
        <button type="button" className="onboarding-skip" onClick={onDismiss}>
          Skip
        </button>
        <div className="onboarding-step">
          <div className="onboarding-icon" aria-hidden="true">
            ✏️
          </div>
          <h2 className="onboarding-title">Drawing Tools</h2>
          <ul className="instructions-tip-list" style={{ textAlign: "left", alignSelf: "stretch" }}>
            <li>Draw with your finger, stylus, or mouse on the canvas.</li>
            <li>Tap a pen color or skin to change how you draw.</li>
            <li>Undo removes your last stroke.</li>
            <li>Use the button below the canvas when you're ready to finish.</li>
          </ul>
        </div>
        <button type="button" className="btn btn-primary onboarding-next" onClick={onDismiss}>
          Got it, let's draw!
        </button>
      </div>
    </div>
  );
}
