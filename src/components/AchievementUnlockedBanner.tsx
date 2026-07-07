import { useEffect, useRef, useState } from "react";
import type { Achievement } from "../app/achievements";
import { randomAchievementUnlockMessage } from "../app/constants";

type AchievementUnlockedBannerProps = {
  achievement: Achievement;
  onCollect: (bannerEl: HTMLElement | null) => void;
  onDismissed: () => void;
};

const FADE_OUT_MS = 300;

/** Fades in as a large celebratory overlay for a newly-unlocked achievement; tapping it collects the coin reward and fades it back out to whatever screen was already showing underneath. */
export default function AchievementUnlockedBanner({ achievement, onCollect, onDismissed }: AchievementUnlockedBannerProps) {
  const [message, setMessage] = useState(randomAchievementUnlockMessage);
  const [closing, setClosing] = useState(false);
  const rewardRef = useRef<HTMLSpanElement | null>(null);

  // The banner is reused (not remounted) as the queue advances to the next
  // achievement, since it's rendered from `pendingAchievements[0]` without a
  // list key - so both the message and the "closing" fade must be reset
  // explicitly whenever a new achievement takes its place.
  useEffect(() => {
    setClosing(false);
    setMessage(randomAchievementUnlockMessage());
  }, [achievement.id]);

  function handleClick() {
    if (closing) return;
    setClosing(true);
    onCollect(rewardRef.current);
    window.setTimeout(onDismissed, FADE_OUT_MS);
  }

  return (
    <button
      type="button"
      className={closing ? "achievement-unlock-overlay achievement-unlock-overlay-closing" : "achievement-unlock-overlay"}
      onClick={handleClick}
      aria-label={`Achievement unlocked: ${achievement.name}. Tap to collect.`}
    >
      <div className="achievement-unlock-card">
        <span className="achievement-unlock-icon" aria-hidden="true">
          {achievement.icon}
        </span>
        <span className="achievement-unlock-headline">Achievement Unlocked!</span>
        <span className="achievement-unlock-message">{message}</span>
        <span className="achievement-unlock-name">{achievement.name}</span>
        <span ref={rewardRef} className="achievement-unlock-reward">
          🪙 +{achievement.coinReward}
        </span>
        <span className="achievement-unlock-hint">Tap to collect</span>
      </div>
    </button>
  );
}
