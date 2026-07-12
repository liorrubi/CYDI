import AppHeader from "../components/AppHeader";
import ScoreCard from "../components/ScoreCard";
import ResultComparison from "../components/ResultComparison";
import StarRating from "../components/StarRating";
import Button from "../components/Button";
import { DEFAULT_PEN_COLOR, type PenColorId } from "../app/constants";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type ResultScreenProps = {
  score: ScoreBreakdown;
  isNewBest: boolean;
  previousBest?: number;
  bestScore?: number;
  /** When provided alongside `attempt`, shows the target shape (gray, semi-transparent guide) behind the player's attempt, same as the Shape Challenge result screen. */
  target?: DrawingPath;
  attempt?: DrawingPath;
  attemptColor?: PenColorId;
  onRetry: () => void;
  onBack: () => void;
  onShareResult?: () => void;
  shareFeedback?: string | null;
  onNavigateToAchievements?: () => void;
  onNavigateToInstructions?: () => void;
  onNavigateToShop?: () => void;
  onNavigateToSpecialChallenge?: () => void;
  onNavigateToShapeChallenge?: () => void;
  onNavigateToHome?: () => void;
  onNavigateToSettings?: () => void;
  onNavigateToCreate?: () => void;
};

export default function ResultScreen({
  score,
  isNewBest,
  previousBest,
  bestScore,
  target,
  attempt,
  attemptColor = DEFAULT_PEN_COLOR,
  onRetry,
  onBack,
  onShareResult,
  shareFeedback,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToShapeChallenge,
  onNavigateToHome,
  onNavigateToSettings,
  onNavigateToCreate,
}: ResultScreenProps) {
  return (
    <div className="screen">
      <AppHeader
        onNavigateToHome={onNavigateToHome}
        onNavigateToInstructions={onNavigateToInstructions}
        onNavigateToAchievements={onNavigateToAchievements}
        onNavigateToShop={onNavigateToShop}
        onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
        onNavigateToShapeChallenge={onNavigateToShapeChallenge}
        onNavigateToSettings={onNavigateToSettings}
      />
      <ScoreCard score={score} isNewBest={isNewBest} />
      <StarRating score={score.total} size={44} />
      {previousBest !== undefined && bestScore !== undefined && (
        <p className="best-summary">
          Your best: <strong>{bestScore}%</strong> <StarRating score={bestScore} size={44} />
        </p>
      )}
      {target && attempt && <ResultComparison target={target} attempt={attempt} attemptColor={attemptColor} />}
      {shareFeedback && <p className="status-text">{shareFeedback}</p>}
      <div className="button-row">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        {onShareResult && (
          <Button variant="secondary" onClick={onShareResult}>
            Share Result
          </Button>
        )}
        <Button onClick={onRetry}>Retry</Button>
      </div>
      {(onNavigateToShapeChallenge || onNavigateToCreate) && (
        <div className="card keep-playing-card">
          <h2>Keep playing CYDI</h2>
          <div className="button-row">
            {onNavigateToShapeChallenge && (
              <Button variant="secondary" onClick={onNavigateToShapeChallenge}>
                Play Shape Challenge
              </Button>
            )}
            {onNavigateToCreate && (
              <Button variant="secondary" onClick={onNavigateToCreate}>
                Create your own challenge
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
