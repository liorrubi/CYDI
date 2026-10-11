import { useEffect, useState } from "react";
import AchievementUnlockedBanner from "../components/AchievementUnlockedBanner";
import AppHeader from "../components/AppHeader";
import StreakStrip from "../components/StreakStrip";
import {
  ACHIEVEMENTS,
  achievementProgressLabel,
  achievementProgressPercent,
  computeAchievementStats,
  isAchievementUnlocked,
  type Achievement,
} from "../app/achievements";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playAchievementUnlockedSound } from "../engine/soundEngine";
import { bankNewAchievements } from "../services/achievementRewards";
import { revealPendingCoins } from "../services/coinsStore";
import { getUnlockedAchievementIds } from "../services/achievementsStore";
import { getProgress } from "../services/shapeChallengeProgress";
import { toAchievements, toHome, toInstructions, toSettings, toShapeChallenge, toShop, toSpecialChallenge } from "../app/routes";
import type { Screen } from "../types/GameMode";

type AchievementsScreenProps = {
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

export default function AchievementsScreen({ from, onNavigate }: AchievementsScreenProps) {
  const [progress] = useState(() => getProgress());
  const [unlockedIds, setUnlockedIds] = useState(() => getUnlockedAchievementIds());
  const [pending, setPending] = useState<Achievement[]>([]);
  const stats = computeAchievementStats(progress);

  // An achievement shown here as reached is paid here too (it used to wait for the next Classic visit): the same
  // shared payer and the same tap-to-collect banner as Classic. Paid once - the id list is written first.
  useEffect(() => {
    const paid = bankNewAchievements(getProgress(), { pending: true });
    if (paid.length === 0) return;
    setUnlockedIds(getUnlockedAchievementIds());
    setPending((prev) => [...prev, ...paid]);
  }, []);
  useEffect(() => {
    if (pending.length > 0) playAchievementUnlockedSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending[0]?.id]);

  return (
    <div className="screen">
      {pending[0] && (
        <AchievementUnlockedBanner
          achievement={pending[0]}
          onCollect={(el) => {
            triggerCoinFlight(el);
            revealPendingCoins();
          }}
          onDismissed={() => setPending((prev) => prev.slice(1))}
        />
      )}
      <AppHeader
        title="Achievements"
        onBack={() => onNavigate(from)}
        onNavigateToAchievements={() => onNavigate(toAchievements(from))}
        onNavigateToInstructions={() => onNavigate(toInstructions(from))}
        onNavigateToShop={() => onNavigate(toShop(from))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      {/* 0.59.0: the Drawing Streak (daily consistency) leads; the achievements below are one-time accomplishments. */}
      <div className="achievement-streak">
        <StreakStrip />
      </div>
      <div className="achievement-list">
        {ACHIEVEMENTS.map((achievement) => {
          const unlocked = unlockedIds.includes(achievement.id) || isAchievementUnlocked(achievement, stats);
          const percent = achievementProgressPercent(achievement, stats);
          return (
            <div
              key={achievement.id}
              className={unlocked ? "card achievement-card" : "card achievement-card achievement-card-locked"}
            >
              <div className="achievement-header">
                <span className="achievement-icon" aria-hidden="true">
                  {achievement.icon}
                </span>
                <div className="achievement-info">
                  <h3>{achievement.name}</h3>
                  <p>{achievement.description}</p>
                </div>
                <span className="achievement-reward">
                  {unlocked && <span className="achievement-reward-check" aria-hidden="true">✓</span>}
                  {`🪙 ${achievement.coinReward}`}
                </span>
              </div>
              <div className="achievement-progress-row">
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                </div>
                <span className="achievement-progress-label">
                  {achievementProgressLabel(achievement, stats)} · {percent}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
