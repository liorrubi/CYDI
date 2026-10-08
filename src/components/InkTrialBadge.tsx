import { penColorById } from "../app/constants";
import { useInkTrialRevision } from "../hooks/useInkTrialRevision";
import { doesActiveTrialApplyOn } from "../services/ads/inkTrialConfig";
import type { InkSurface } from "../services/ads/inkTrialConfigSchema";
import { getActiveInkTrial, isTrialOverlayOn } from "../services/inkTrialStore";

type InkTrialBadgeProps = {
  surface: InkSurface;
  className?: string;
  /** Wrap it in its own centred row - and render no row at all without a Trial, so no empty gap is left behind. */
  asRow?: boolean;
};

/**
 * "🌈 Rainbow Ink · 4 plays left" - a small chip while a Trial is drawing on this surface. Plays, never games or
 * rounds. Updates the moment a play/session is consumed and disappears when the Trial ends, when the player switches
 * to another ink, or when the ink is owned (ownership ends the Trial). Never interactive, never over the canvas.
 */
export default function InkTrialBadge({ surface, className, asRow = false }: InkTrialBadgeProps) {
  useInkTrialRevision();
  const trial = getActiveInkTrial();
  if (trial === null || !isTrialOverlayOn() || !doesActiveTrialApplyOn(surface)) return null;
  const option = penColorById(trial.ink);
  const chip = (
    <span className={className ? `ink-trial-badge ink-trial-badge-${trial.ink} ${className}` : `ink-trial-badge ink-trial-badge-${trial.ink}`}>
      <span aria-hidden="true">{option.icon}</span> {option.name} · {trial.usesLeft} {trial.usesLeft === 1 ? "play" : "plays"} left
    </span>
  );
  return asRow ? <div className="ink-trial-badge-row">{chip}</div> : chip;
}
