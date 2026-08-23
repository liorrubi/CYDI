import { useState } from "react";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import { playChipSound } from "../../engine/soundEngine";
import { trackEvent } from "../../services/analytics";
import { LABEL_BY_ROLE, STEPS_BY_ROLE, type TutorialRole } from "./tutorialSteps";

type MultiplayerTutorialOverlayProps = {
  /** "passPlay" is the local two-player mode; the other two are the roles inside a live room. */
  role: TutorialRole;
  onDismiss: () => void;
};

const TUTORIAL_TYPE_BY_ROLE = {
  host: "multiplayerHost",
  guest: "multiplayerGuest",
  passPlay: "twoPlayers",
} as const;

export default function MultiplayerTutorialOverlay({ role, onDismiss }: MultiplayerTutorialOverlayProps) {
  const steps = STEPS_BY_ROLE[role];
  const [index, setIndex] = useState(0);
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onDismiss });

  const step = steps[index];
  const isLast = index === steps.length - 1;

  function finish() {
    // One event per explanation, whether it was read through or skipped: the
    // flag is set either way, so this is the moment it is done with.
    trackEvent("tutorial_completed", { tutorialType: TUTORIAL_TYPE_BY_ROLE[role] });
    onDismiss();
  }

  function next() {
    playChipSound();
    if (isLast) finish();
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
        <button type="button" className="onboarding-skip" onClick={finish}>
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
