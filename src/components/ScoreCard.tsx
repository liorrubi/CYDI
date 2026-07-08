import { improvementTip } from "../app/constants";
import type { ScoreBreakdown } from "../types/Score";

type ScoreCardProps = {
  score: ScoreBreakdown;
  isNewBest?: boolean;
  /** Appends a "%" to the headline number - for screens (like Daily Challenge) that drop the star rating and need the number to read as a percentage on its own. */
  showPercentSign?: boolean;
};

export default function ScoreCard({ score, isNewBest, showPercentSign }: ScoreCardProps) {
  const tip = improvementTip(score);
  return (
    <div className="card score-card">
      {isNewBest && <div className="record-banner">New personal best!</div>}
      <div className="score-total">
        {score.total}
        {showPercentSign && "%"}
      </div>
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
      </div>
      {tip && <p className="score-improvement-tip">💡 {tip}</p>}
    </div>
  );
}
