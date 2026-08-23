/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useDialogA11y } from "../hooks/useDialogA11y";
import { playChipSound } from "../engine/soundEngine";
import { trackEvent } from "../services/analytics";

type ModeIntroOverlayProps = {
  onDismiss: () => void;
};

const MODES = [
  { icon: "🎯", name: "Classic", blurb: "the original CYDI challenges" },
  { icon: "📱", name: "2 Players", blurb: "take turns on one device" },
  { icon: "🌍", name: "Multiplayer", blurb: "play together on separate devices" },
];

/**
 * One card, shown once, telling a new player that the selector at the top of
 * Home leads somewhere.
 *
 * Deliberately three lines and nothing else. Rooms, QR codes, hosts, speed
 * bonuses and Social Points are all real things a player will meet, and every
 * one of them is explained by the mode that owns it, at the moment it becomes
 * true. Front-loading them here would turn "here is what CYDI is" into a manual
 * somebody has to get through before playing - which is exactly what the
 * existing onboarding was cut down from.
 */
export default function ModeIntroOverlay({ onDismiss }: ModeIntroOverlayProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onDismiss });

  function dismiss() {
    playChipSound();
    trackEvent("tutorial_completed", { tutorialType: "classicModeIntro" });
    onDismiss();
  }

  return (
    <div className="onboarding-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="onboarding-card onboarding-accent-purple mode-intro-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-intro-title"
      >
        <button type="button" className="onboarding-skip" onClick={onDismiss}>
          Skip
        </button>

        <h2 id="mode-intro-title" className="onboarding-title">
          Choose how to play
        </h2>

        <ul className="mode-intro-list">
          {MODES.map((mode) => (
            <li key={mode.name}>
              <span className="mode-intro-icon" aria-hidden="true">
                {mode.icon}
              </span>
              <span>
                <strong>{mode.name}</strong> — {mode.blurb}
              </span>
            </li>
          ))}
        </ul>

        <p className="mp-hint mode-intro-hint">Switch any time from the tabs at the top.</p>

        <button type="button" className="btn btn-primary onboarding-next" onClick={dismiss}>
          Got it!
        </button>
      </div>
    </div>
  );
}
