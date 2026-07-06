import { useEffect, useRef, useState } from "react";
import type { Achievement } from "../app/achievements";
import { randomAchievementUnlockMessage } from "../app/constants";

type AchievementUnlockedBannerProps = {
  achievement: Achievement;
  onCollect: (bannerEl: HTMLElement | null) => void;
  onDismissed: () => void;
};

const FADE_OUT_MS = 300;

/** Fades in to celebrate a newly-unlocked achievement; tapping it collects the coin reward and fades it back out. */
export default function AchievementUnlockedBanner({ achievement, onCollect, onDismissed }: AchievementUnlockedBannerProps) {
  const [message] = useState(randomAchievementUnlockMessage);
  const [closing, setClosing] = useState(false);
  const bannerRef = useRef<HTMLButtonElement | null>(null);

  // A new achievement replacing the previous one should start fresh (not still "closing").
  useEffect(() => {
    setClosing(false);
  }, [achievement.id]);

  function handleClick() {
    if (closing) return;
    setClosing(true);
    onCollect(bannerRef.current);
    window.setTimeout(onDismissed, FADE_OUT_MS);
  }

  return (
    <button
      ref={bannerRef}
      type="button"
      className={closing ? "achievement-unlock-banner achievement-unlock-banner-closing" : "achievement-unlock-banner"}
      onClick={handleClick}
    >
      <span className="achievement-unlock-icon" aria-hidden="true">
        {achievement.icon}
      </span>
      <span className="achievement-unlock-text">
        <span className="achievement-unlock-message">{message}</span>
        <span className="achievement-unlock-name">{achievement.name}</span>
      </span>
      <span className="achievement-unlock-reward">🪙 +{achievement.coinReward}</span>
    </button>
  );
}
