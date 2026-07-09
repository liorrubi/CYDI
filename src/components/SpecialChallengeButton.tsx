import { useEffect, useState } from "react";
import { SPECIAL_CHALLENGE_UNLOCK_COUNT } from "../app/constants";
import { canPlaySpecialChallengeFree } from "../services/specialChallengeStore";
import { onSaveDataChanged } from "../services/saveStore";
import { getSuccessfulDrawingsCount } from "../services/successfulDrawingsStore";
import { isUnlockEverythingActive } from "../services/unlockOverrideStore";

type SpecialChallengeButtonProps = {
  onNavigateToSpecialChallenge?: () => void;
};

/** Header shortcut for the once-a-day free Special Challenge. Locked until the player has passed enough Shape Challenge attempts; once unlocked it always navigates to the same screen, which handles both the free attempt and any paid retries. */
export default function SpecialChallengeButton({ onNavigateToSpecialChallenge }: SpecialChallengeButtonProps) {
  const [available, setAvailable] = useState(() => canPlaySpecialChallengeFree());
  const [successfulDrawings, setSuccessfulDrawings] = useState(() => getSuccessfulDrawingsCount());

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
    if (locked) return;
    onNavigateToSpecialChallenge?.();
  }

  const label = locked
    ? `Unlocks after ${SPECIAL_CHALLENGE_UNLOCK_COUNT} successful drawings - ${successfulDrawings}/${SPECIAL_CHALLENGE_UNLOCK_COUNT}`
    : available
      ? "Special Challenge - available, tap to play"
      : "Special Challenge already played today - tap to try again for 🪙 100";

  return (
    <button
      type="button"
      className="special-challenge-shortcut"
      onClick={handleClick}
      disabled={locked}
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
  );
}
