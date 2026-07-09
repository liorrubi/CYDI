import { useEffect, useState } from "react";
import { SPECIAL_CHALLENGE_UNLOCK_COUNT } from "../app/constants";
import { canPlaySpecialChallengeFree } from "../services/specialChallengeStore";
import { onSaveDataChanged } from "../services/saveStore";
import { getSuccessfulDrawingsCount } from "../services/successfulDrawingsStore";
import { isUnlockEverythingActive } from "../services/unlockOverrideStore";
import LockedFeatureHint from "./LockedFeatureHint";

type SpecialChallengeButtonProps = {
  onNavigateToSpecialChallenge?: () => void;
  /** Where to send the player when they tap the crown while it's still locked, via the hint's "Go to Shape Challenge" action. */
  onNavigateToShapeChallenge?: () => void;
};

/** Header shortcut for the once-a-day free Special Challenge. Locked until the player has passed enough Shape Challenge attempts - while locked it's still tappable and shows a hint explaining what to do instead of just disabling; once unlocked it always navigates to the same screen, which handles both the free attempt and any paid retries. */
export default function SpecialChallengeButton({ onNavigateToSpecialChallenge, onNavigateToShapeChallenge }: SpecialChallengeButtonProps) {
  const [available, setAvailable] = useState(() => canPlaySpecialChallengeFree());
  const [successfulDrawings, setSuccessfulDrawings] = useState(() => getSuccessfulDrawingsCount());
  const [showLockedHint, setShowLockedHint] = useState(false);

  useEffect(
    () =>
      onSaveDataChanged(() => {
        setAvailable(canPlaySpecialChallengeFree());
        setSuccessfulDrawings(getSuccessfulDrawingsCount());
      }),
    [],
  );

  const locked = !isUnlockEverythingActive() && successfulDrawings < SPECIAL_CHALLENGE_UNLOCK_COUNT;

  function handleClick() {
    if (locked) {
      setShowLockedHint((shown) => !shown);
      return;
    }
    onNavigateToSpecialChallenge?.();
  }

  function handleGoToShapeChallenge() {
    setShowLockedHint(false);
    onNavigateToShapeChallenge?.();
  }

  const label = locked
    ? `Unlocks after ${SPECIAL_CHALLENGE_UNLOCK_COUNT} successful drawings - ${successfulDrawings}/${SPECIAL_CHALLENGE_UNLOCK_COUNT}`
    : available
      ? "Special Challenge - available, tap to play"
      : "Special Challenge already played today - tap to try again for 🪙 100";

  return (
    <div className="header-icon-anchor">
      <button
        type="button"
        className="special-challenge-shortcut"
        onClick={handleClick}
        aria-label={label}
        title={locked ? label : undefined}
      >
        👑
        {locked ? (
          <span className="special-challenge-badge-locked" aria-hidden="true">
            {successfulDrawings}/{SPECIAL_CHALLENGE_UNLOCK_COUNT}
          </span>
        ) : available ? (
          <span className="special-challenge-badge-free" aria-hidden="true">
            FREE
          </span>
        ) : (
          <span className="special-challenge-badge-retry" aria-hidden="true">
            🪙
          </span>
        )}
      </button>
      {showLockedHint && locked && (
        <LockedFeatureHint
          message="Complete more Shape Challenges to unlock this feature"
          onNavigateToShapeChallenge={handleGoToShapeChallenge}
          onDismiss={() => setShowLockedHint(false)}
        />
      )}
    </div>
  );
}
