import ScoreCard from "../components/ScoreCard";
import Button from "../components/Button";
import type { ScoreBreakdown } from "../types/Score";

type ResultScreenProps = {
  score: ScoreBreakdown;
  isNewBest: boolean;
  onRetry: () => void;
  onBack: () => void;
};

export default function ResultScreen({ score, isNewBest, onRetry, onBack }: ResultScreenProps) {
  return (
    <div className="screen">
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
