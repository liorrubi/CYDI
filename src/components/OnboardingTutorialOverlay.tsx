import { useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";

type OnboardingTutorialOverlayProps = {
  onDismiss: () => void;
};

type OnboardingStep = {
  icon: string;
  title: string;
  text: string;
  accent: "primary" | "purple" | "orange" | "green" | "gold";
};

const STEPS: OnboardingStep[] = [
  {
    icon: "👋",
    title: "Welcome to CYDI!",
    text: "The game shows you a shape - draw it as accurately as you can and earn a score out of 100 plus stars.",
    accent: "primary",
  },
  {
    icon: "✏️",
    title: "Shape Challenge",
    text: "Draw the shape the game shows you. Score well to pass levels and unlock new shapes and categories.",
    accent: "purple",
  },
  {
    icon: "🧠",
    title: "Daily Challenge",
    text: "Memorize the shape, then draw it from memory. One new challenge every day - race for the top score!",
    accent: "orange",
  },
  {
    icon: "🎨",
    title: "Create & Share",
    text: "Draw your own challenges and share them with friends to see who can copy them best.",
    accent: "green",
  },
  {
    icon: "🪙",
    title: "Coins & Shop",
    text: "Great drawings and achievements earn you CYDI Coins. Spend them in the Shop on pen colors and more!",
    accent: "gold",
  },
];

/** A short step-by-step intro modal for new players: one card per game mode, with Next/Skip navigation. */
export default function OnboardingTutorialOverlay({ onDismiss }: OnboardingTutorialOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onDismiss });

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  function handleNext() {
    if (isLastStep) {
      onDismiss();
    } else {
      setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
    }
  }

  return (
    <div className="onboarding-overlay" role="presentation">
      <div
        ref={dialogRef}
        className={`onboarding-card onboarding-accent-${step.accent}`}
        role="dialog"
        aria-modal="true"
        aria-label="Game tutorial"
      >
        {/* Kept in the layout (hidden, not unmounted) on step 1 so the header stays balanced. */}
        <button
          type="button"
          className="onboarding-back"
          onClick={() => setStepIndex((index) => Math.max(index - 1, 0))}
          style={stepIndex === 0 ? { visibility: "hidden" } : undefined}
        >
          Back
        </button>
        <button type="button" className="onboarding-skip" onClick={onDismiss}>
          Skip
        </button>
        {/* Keyed by step so the pop-in animation replays on every step change. */}
        <div key={stepIndex} className="onboarding-step">
          <div className="onboarding-icon" aria-hidden="true">
            {step.icon}
          </div>
          <h2 className="onboarding-title">{step.title}</h2>
          <p className="onboarding-text">{step.text}</p>
        </div>
        <div className="onboarding-dots" aria-hidden="true">
          {STEPS.map((_, index) => (
            <span key={index} className={index === stepIndex ? "onboarding-dot onboarding-dot-active" : "onboarding-dot"} />
          ))}
        </div>
        <button type="button" className="btn btn-primary onboarding-next" onClick={handleNext}>
          {isLastStep ? "Start Playing" : "Next"}
        </button>
      </div>
    </div>
  );
}
