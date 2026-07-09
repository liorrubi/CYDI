import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ScoreCard from "../components/ScoreCard";
import ShapeOverlayCanvas from "../components/ShapeOverlayCanvas";
import StarRating from "../components/StarRating";
import { CANVAS_SIZE } from "../app/constants";
import { getChallenge, updateChallenge } from "../services/challengeStorage";
import type { DecodedSharedResult } from "../services/shareLink";
import {
  toAchievements,
  toHome,
  toInstructions,
  toPlay,
  toSettings,
  toShapeChallenge,
  toShop,
  toSharedResult,
  toSpecialChallenge,
} from "../app/routes";
import type { Screen } from "../types/GameMode";

type SharedResultScreenProps = {
  data: DecodedSharedResult;
  onNavigate: (screen: Screen) => void;
};

/** Read-only landing page for a "Share Result Back" link - shows a friend's score on a challenge, with no live play session of its own. */
export default function SharedResultScreen({ data, onNavigate }: SharedResultScreenProps) {
  const from = toSharedResult(data);

  function handlePlayThisChallenge() {
    const existing = getChallenge(data.challengeId);
    updateChallenge({
      id: data.challengeId,
      name: data.challengeName,
      target: data.target,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: existing?.updatedAt ?? Date.now(),
      personalBest: existing?.personalBest,
      attempts: existing?.attempts ?? 0,
    });
    onNavigate(toPlay(data.challengeId));
  }

  return (
    <div className="screen">
      <AppHeader
        title={data.challengeName}
        subtitle="Shared result"
        onNavigateToAchievements={() => onNavigate(toAchievements(from))}
        onNavigateToInstructions={() => onNavigate(toInstructions(from))}
        onNavigateToShop={() => onNavigate(toShop(from))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      <ScoreCard score={data.score} />
      <StarRating score={data.score.total} size={44} />
      <div className="canvas-wrapper">
        <ShapeOverlayCanvas target={data.target} attempt={data.attempt} width={CANVAS_SIZE} height={CANVAS_SIZE} />
      </div>
      <p className="overlay-legend">
        <span className="overlay-legend-swatch overlay-legend-target" /> Target shape
        <span className="overlay-legend-swatch" style={{ background: "#1e202e", marginLeft: "var(--space-3)" }} /> Their
        drawing
      </p>
      <div className="button-row">
        <Button variant="secondary" onClick={() => onNavigate(toHome())}>
          Home
        </Button>
        <Button onClick={handlePlayThisChallenge}>Play This Challenge</Button>
      </div>
    </div>
  );
}
