import { useEffect, useState } from "react";
import { DAILY_CHEST, DAILY_CHEST_UNLOCK_COUNT } from "../app/constants";
import { canOpenDailyChest, openDailyChest } from "../services/dailyChestStore";
import { onSaveDataChanged } from "../services/saveStore";
import { getSuccessfulDrawingsCount } from "../services/successfulDrawingsStore";
import { isUnlockEverythingActive } from "../services/unlockOverrideStore";
import ChestRewardOverlay from "./ChestRewardOverlay";
import LockedFeatureHint from "./LockedFeatureHint";

type DailyChestButtonProps = {
  /** Where to send the player once today's free chest is already claimed - the button becomes a shortcut into the shop's Chest Keys section. */
  onNavigateToShop?: () => void;
  /** Where to send the player when they tap the chest while it's still locked, via the hint's "Go to Shape Challenge" action. */
  onNavigateToShapeChallenge?: () => void;
};

/** Header shortcut for the once-a-day free chest. Locked until the player has passed enough Shape Challenge attempts - while locked it's still tappable and shows a hint explaining what to do instead of just disabling; once unlocked it's never disabled again: while available it opens the chest, and once claimed for the day it turns into a shortcut to buy more chests in the shop. */
export default function DailyChestButton({ onNavigateToShop, onNavigateToShapeChallenge }: DailyChestButtonProps) {
  const [available, setAvailable] = useState(() => canOpenDailyChest());
  const [successfulDrawings, setSuccessfulDrawings] = useState(() => getSuccessfulDrawingsCount());
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [showLockedHint, setShowLockedHint] = useState(false);

  useEffect(
    () =>
      onSaveDataChanged(() => {
        setAvailable(canOpenDailyChest());
        setSuccessfulDrawings(getSuccessfulDrawingsCount());
      }),
    [],
  );

  const locked = !isUnlockEverythingActive() && successfulDrawings < DAILY_CHEST_UNLOCK_COUNT;

  function handleClick() {
    if (locked) {
      setShowLockedHint((shown) => !shown);
      return;
    }
    if (available) {
      setPendingAmount(openDailyChest());
      setAvailable(false);
    } else {
      onNavigateToShop?.();
    }
  }

  function handleGoToShapeChallenge() {
    setShowLockedHint(false);
    onNavigateToShapeChallenge?.();
  }

  const label = locked
    ? `Unlocks after ${DAILY_CHEST_UNLOCK_COUNT} successful drawings - ${successfulDrawings}/${DAILY_CHEST_UNLOCK_COUNT}`
    : available
      ? "Daily free chest - available, tap to open"
      : "Daily chest already opened today - tap to buy more chests in the shop";

  return (
    <div className="header-icon-anchor">
      <button
        type="button"
        className="daily-chest-shortcut"
        onClick={handleClick}
        aria-label={label}
        title={locked ? label : undefined}
      >
        {DAILY_CHEST.icon}
        {locked ? (
          <span className="daily-chest-badge-locked" aria-hidden="true">
            {successfulDrawings}/{DAILY_CHEST_UNLOCK_COUNT}
          </span>
        ) : available ? (
          <span className="daily-chest-badge-free" aria-hidden="true">
            FREE
          </span>
        ) : (
          <span className="daily-chest-badge-shop" aria-hidden="true">
            🔑
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
      {pendingAmount !== null && (
        <ChestRewardOverlay
          chestName={DAILY_CHEST.name}
          chestIcon={DAILY_CHEST.icon}
          tierClassName="chest-reward-card-wood"
          amount={pendingAmount}
          rewardMin={DAILY_CHEST.rewardMin}
          rewardMax={DAILY_CHEST.rewardMax}
          isPaidChest={false}
          onDismissed={() => setPendingAmount(null)}
        />
      )}
    </div>
  );
}
