import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ScoreCard from "../components/ScoreCard";
import ShapeOverlayCanvas from "../components/ShapeOverlayCanvas";
import StarRating from "../components/StarRating";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, penColorCssBackground } from "../app/constants";
import type { DecodedSharedArtistResult } from "../services/shareLink";
import {
  toAchievements,
  toArtistPack,
  toHome,
  toInstructions,
  toSettings,
  toShapeChallenge,
  toShop,
  toSharedArtistResult,
} from "../app/routes";
import type { Screen } from "../types/GameMode";

type SharedArtistResultScreenProps = {
  data: DecodedSharedArtistResult;
  onNavigate: (screen: Screen) => void;
};

/**
 * Read-only landing page for an Artist Pack "Share Result" link. It shows ONLY
 * the sharer's own drawing - never the reference artwork or the draw-along guide
 * (the payload carries no target at all, so there is nothing to leak, even if
 * Show Guide was on while they drew) - plus the score and the artist credit.
 */
export default function SharedArtistResultScreen({ data, onNavigate }: SharedArtistResultScreenProps) {
  const from = toSharedArtistResult(data);

  return (
    <div className="screen">
      <AppHeader
        title={data.artworkName}
        subtitle={`Shared result · ${data.packName}`}
        onNavigateToAchievements={() => onNavigate(toAchievements(from))}
        onNavigateToInstructions={() => onNavigate(toInstructions(from))}
        onNavigateToShop={() => onNavigate(toShop(from))}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      <ScoreCard score={data.score} />
      <StarRating score={data.score.total} size={44} />
      <div className="canvas-wrapper">
        {/* No `target` prop: the guide/reference artwork is deliberately never rendered here. */}
        <ShapeOverlayCanvas attempt={data.attempt} attemptColor={data.attemptColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
      </div>
      <p className="overlay-legend">
        <span
          className="overlay-legend-swatch"
          style={{ background: penColorCssBackground(data.attemptColor ?? DEFAULT_PEN_COLOR) }}
        />{" "}
        Their drawing
      </p>
      <p className="artist-artwork-credit artist-artwork-credit-result">🎨 Inspired by {data.artistName}</p>
      <div className="button-row">
        <Button variant="secondary" onClick={() => onNavigate(toHome())}>
          Home
        </Button>
        <Button onClick={() => onNavigate(toArtistPack(data.packId))}>Open Artist Pack</Button>
      </div>
    </div>
  );
}
