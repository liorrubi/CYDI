import AppHeader from "../components/AppHeader";
import ScoreCard from "../components/ScoreCard";
import ShapeOverlayCanvas from "../components/ShapeOverlayCanvas";
import StarRating from "../components/StarRating";
import Button from "../components/Button";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, penColorCssBackground, type PenColorId } from "../app/constants";
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
  onNavigateToHome?: () => void;
  onNavigateToSettings?: () => void;
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
  onNavigateToHome,
  onNavigateToSettings,
}: ResultScreenProps) {
  return (
    <div className="screen">
      <AppHeader
        onNavigateToHome={onNavigateToHome}
        onNavigateToInstructions={onNavigateToInstructions}
        onNavigateToAchievements={onNavigateToAchievements}
        onNavigateToShop={onNavigateToShop}
        onNavigateToSettings={onNavigateToSettings}
      />
      <ScoreCard score={score} isNewBest={isNewBest} />
      <StarRating score={score.total} size={44} />
      {previousBest !== undefined && bestScore !== undefined && (
        <p className="best-summary">
          Your best: <strong>{bestScore}%</strong> <StarRating score={bestScore} size={44} />
        </p>
      )}
      {target && attempt && (
        <>
          <div className="canvas-wrapper">
            <ShapeOverlayCanvas target={target} attempt={attempt} attemptColor={attemptColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
          </div>
          <p className="overlay-legend">
            <span className="overlay-legend-swatch overlay-legend-target" /> Target shape
            <span
              className="overlay-legend-swatch"
              style={{ background: penColorCssBackground(attemptColor), marginLeft: "var(--space-3)" }}
            />{" "}
            Your drawing
          </p>
        </>
      )}
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
    </div>
  );
}
