import { useState } from "react";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import { playChipSound } from "../../engine/soundEngine";
import { LABEL_BY_ROLE, STEPS_BY_ROLE, type TutorialRole } from "./tutorialSteps";

type MultiplayerTutorialOverlayProps = {
  /** "passPlay" is the local two-player mode; the other two are the roles inside a live room. */
  role: TutorialRole;
  onDismiss: () => void;
};

export default function MultiplayerTutorialOverlay({ role, onDismiss }: MultiplayerTutorialOverlayProps) {
  const steps = STEPS_BY_ROLE[role];
  const [index, setIndex] = useState(0);
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onDismiss });

  const step = steps[index];
  const isLast = index === steps.length - 1;

  function next() {
    playChipSound();
    if (isLast) onDismiss();
    else setIndex((i) => i + 1);
  }

  return (
    <div className="onboarding-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="onboarding-card onboarding-accent-purple mp-tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-label={LABEL_BY_ROLE[role]}
      >
        <button type="button" className="onboarding-skip" onClick={onDismiss}>
          Skip
        </button>

        <div className="onboarding-step">
          <div className="onboarding-icon" aria-hidden="true">
            {step.icon}
          </div>
          <h2 className="onboarding-title">{step.title}</h2>
          <p className="mp-tutorial-body">{step.body}</p>
        </div>

        <div className="mp-tutorial-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i === index ? "mp-dot mp-dot-active" : "mp-dot"} />
          ))}
        </div>

        <p className="sr-only" aria-live="polite">
          Step {index + 1} of {steps.length}
        </p>

        <button type="button" className="btn btn-primary onboarding-next" onClick={next}>
          {isLast ? "Got it!" : "Next"}
        </button>
      </div>
    </div>
  );
}
