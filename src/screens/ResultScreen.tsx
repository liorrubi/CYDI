import ScoreCard from "../components/ScoreCard";
import StarRating from "../components/StarRating";
import Button from "../components/Button";
import CoinIndicator from "../components/CoinIndicator";
import SoundToggleButton from "../components/SoundToggleButton";
import { playAchievementsPeekSound, playInfoPeekSound } from "../engine/soundEngine";
import type { ScoreBreakdown } from "../types/Score";

type ResultScreenProps = {
  score: ScoreBreakdown;
  isNewBest: boolean;
  previousBest?: number;
  bestScore?: number;
  onRetry: () => void;
  onBack: () => void;
  onNavigateToAchievements?: () => void;
  onNavigateToInstructions?: () => void;
};

export default function ResultScreen({
  score,
  isNewBest,
  previousBest,
  bestScore,
  onRetry,
  onBack,
  onNavigateToAchievements,
  onNavigateToInstructions,
}: ResultScreenProps) {
  return (
    <div className="screen">
      <div className="app-header-actions">
        {onNavigateToInstructions && (
          <button
            type="button"
            className="info-shortcut"
            onClick={() => {
              playInfoPeekSound();
              onNavigateToInstructions();
            }}
            aria-label="How to play"
          >
            i
          </button>
        )}
        {onNavigateToAchievements && (
          <button
            type="button"
            className="achievements-shortcut"
            onClick={() => {
              playAchievementsPeekSound();
              onNavigateToAchievements();
            }}
            aria-label="Achievements"
          >
            🏆
          </button>
        )}
        <CoinIndicator />
        <SoundToggleButton />
      </div>
      <ScoreCard score={score} isNewBest={isNewBest} />
      <StarRating score={score.total} size={44} />
      {previousBest !== undefined && bestScore !== undefined && (
        <p className="best-summary">
          Your best: <strong>{bestScore}%</strong> <StarRating score={bestScore} size={44} />
        </p>
      )}
      <div className="button-row">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}
