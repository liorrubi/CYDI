import type { ScoreBreakdown } from "../types/Score";

type ScoreCardProps = {
  score: ScoreBreakdown;
  isNewBest?: boolean;
};

export default function ScoreCard({ score, isNewBest }: ScoreCardProps) {
  return (
    <div className="card score-card">
      {isNewBest && <div className="record-banner">New personal best!</div>}
      <div className="score-total">{score.total}</div>
      <div className="score-message">{score.message}</div>
      <div className="score-grid">
        <div>
          <span>Shape</span>
          <strong>{score.shapeMatch}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{score.coverage}</strong>
        </div>
        <div>
          <span>Smoothness</span>
          <strong>{score.smoothness}</strong>
        </div>
        <div>
          <span>Scale</span>
          <strong>{score.scale}</strong>
        </div>
        {score.closure !== undefined && (
          <div>
            <span>Closure</span>
            <strong>{score.closure}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
