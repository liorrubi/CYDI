import AppHeader from "../components/AppHeader";
import { SCORE_PARAMETERS, SCORE_WEIGHTS, STAR_RATING_THRESHOLDS } from "../app/constants";
import { toAchievements, toInstructions } from "../app/routes";
import type { Screen } from "../types/GameMode";

type InstructionsScreenProps = {
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

function starRangeLabel(index: number): string {
  const upper = index === 0 ? 100 : STAR_RATING_THRESHOLDS[index - 1].minScore - 1;
  const lower = STAR_RATING_THRESHOLDS[index].minScore;
  return `${lower}–${upper}`;
}

export default function InstructionsScreen({ from, onNavigate }: InstructionsScreenProps) {
  const zeroStarUpper = STAR_RATING_THRESHOLDS[STAR_RATING_THRESHOLDS.length - 1].minScore - 1;

  return (
    <div className="screen">
      <AppHeader
        title="How to Play"
        onBack={() => onNavigate(from)}
        onNavigateToAchievements={() => onNavigate(toAchievements(from))}
        onNavigateToInstructions={() => onNavigate(toInstructions(from))}
      />

      <div className="card instructions-card">
        <p>
          CYDI shows you a shape. Study it, then draw it as accurately as you can. When you're done, you'll get a
          score out of 100 and a star rating.
        </p>
      </div>

      <div className="card instructions-card">
        <h2>How Your Score Works</h2>
        <p className="status-text">Your total score is built from four parts:</p>
        <div className="instructions-param-list">
          {SCORE_PARAMETERS.map((param) => (
            <div key={param.key} className="instructions-param">
              <div className="instructions-param-header">
                <strong>{param.name}</strong>
                <span className="instructions-param-weight">{Math.round(SCORE_WEIGHTS[param.key] * 100)}%</span>
              </div>
              <p>{param.description}</p>
              <p className="instructions-param-tip">💡 {param.tip}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card instructions-card">
        <h2>Star Rating</h2>
        <p className="status-text">Your total score decides how many stars you earn:</p>
        <div className="instructions-star-list">
          {STAR_RATING_THRESHOLDS.map((threshold, index) => (
            <div key={threshold.stars} className="instructions-star-row">
              <span>{starRangeLabel(index)}</span>
              <span aria-hidden="true">{"★".repeat(threshold.stars) + "☆".repeat(5 - threshold.stars)}</span>
            </div>
          ))}
          <div className="instructions-star-row">
            <span>0–{zeroStarUpper}</span>
            <span aria-hidden="true">☆☆☆☆☆</span>
          </div>
        </div>
      </div>

      <div className="card instructions-card">
        <h2>A Few Tips</h2>
        <ul className="instructions-tip-list">
          <li>You can lift your finger or release the mouse mid-drawing and keep going without starting over.</li>
          <li>Some shapes need a line drawn twice, or crossing lines like an X - that's expected and won't lower your score.</li>
        </ul>
      </div>
    </div>
  );
}
