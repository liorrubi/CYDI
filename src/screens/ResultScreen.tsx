import ScoreCard from "../components/ScoreCard";
import Button from "../components/Button";
import CoinIndicator from "../components/CoinIndicator";
import SoundToggleButton from "../components/SoundToggleButton";
import { playAchievementsPeekSound } from "../engine/soundEngine";
import type { ScoreBreakdown } from "../types/Score";

type ResultScreenProps = {
  score: ScoreBreakdown;
  isNewBest: boolean;
  onRetry: () => void;
  onBack: () => void;
  onNavigateToAchievements?: () => void;
};

export default function ResultScreen({ score, isNewBest, onRetry, onBack, onNavigateToAchievements }: ResultScreenProps) {
  return (
    <div className="screen">
      <div className="app-header-actions">
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
      <div className="button-row">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}
