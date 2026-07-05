import AppHeader from "../components/AppHeader";
import {
  ACHIEVEMENTS,
  achievementProgressLabel,
  achievementProgressPercent,
  computeAchievementStats,
  isAchievementUnlocked,
} from "../app/achievements";
import { getUnlockedAchievementIds } from "../services/achievementsStore";
import { getProgress } from "../services/shapeChallengeProgress";
import { toAchievements } from "../app/routes";
import type { Screen } from "../types/GameMode";

type AchievementsScreenProps = {
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

export default function AchievementsScreen({ from, onNavigate }: AchievementsScreenProps) {
  const progress = getProgress();
  const stats = computeAchievementStats(progress);
  const unlockedIds = getUnlockedAchievementIds();

  return (
    <div className="screen">
      <AppHeader
        title="Achievements"
        onBack={() => onNavigate(from)}
        onNavigateToAchievements={() => onNavigate(toAchievements(from))}
      />
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
