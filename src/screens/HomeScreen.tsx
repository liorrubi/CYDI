import AppHeader from "../components/AppHeader";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import { getShapeById, type ShapeDefinition } from "../content/contentRepository";
import { APP_NAME, APP_TAGLINE } from "../app/constants";
import {
  toAchievements,
  toCreate,
  toDailyChallenge,
  toHome,
  toInstructions,
  toList,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import { playSelectSound } from "../engine/soundEngine";
import { isAndroidApp, PLAY_STORE_URL } from "../services/nativeShare";
import type { Screen } from "../types/GameMode";

type HomeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

/**
 * Three shapes from the regular catalog, drawn on the Shape Challenge card so the home
 * screen shows what the game is before you tap into it. Picked for silhouette contrast
 * (a drawn gesture / an everyday object / an organic form), for reading clearly at icon
 * size, and for not combining into a single scene the way e.g. a house and a cloud would.
 * Ids are looked up rather than hardcoded paths, so a content source that lacks one just
 * drops it.
 */
const FEATURED_PREVIEW_SHAPE_IDS = ["spiral-2", "home-mug", "nat-mushroom"];

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  function handleSelect(screen: Screen) {
    playSelectSound();
    onNavigate(screen);
  }

  // Hidden inside the Android app itself, where "get the app" is meaningless -
  // this is the website's install CTA only.
  const showGetTheApp = !isAndroidApp();

  const previewShapes = FEATURED_PREVIEW_SHAPE_IDS.map(getShapeById).filter(
    (shape): shape is ShapeDefinition => shape !== undefined,
  );

  function handleGetTheApp() {
    playSelectSound();
    window.open(PLAY_STORE_URL, "_blank", "noopener");
  }

  return (
    <div className="screen">
      <AppHeader
        title={APP_NAME}
        subtitle={APP_TAGLINE}
        onNavigateToAchievements={() => handleSelect(toAchievements(toHome()))}
        onNavigateToInstructions={() => handleSelect(toInstructions(toHome()))}
        onNavigateToShop={() => handleSelect(toShop(toHome()))}
        onNavigateToSpecialChallenge={() => handleSelect(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => handleSelect(toShapeChallenge())}
        onNavigateToSettings={() => handleSelect(toSettings())}
      />
      <div className="home-cards">
        <button
          type="button"
          className="card home-card home-card-accent-purple home-card-featured"
          onClick={() => handleSelect(toShapeChallenge())}
        >
          <h2>Shape Challenge</h2>
          <p>Draw what the game shows you</p>
          {previewShapes.length > 0 && (
            <div className="home-card-preview">
              {previewShapes.map((shape) => (
                <ShapePreviewIcon key={shape.id} shape={shape} size={52} />
              ))}
            </div>
          )}
        </button>
        <button
          type="button"
          className="card home-card home-card-accent-orange"
          onClick={() => handleSelect(toDailyChallenge())}
        >
          <h2>Daily Challenge</h2>
          <p>Draw from memory, race for the top score</p>
        </button>
        <button
          type="button"
          className="card home-card home-card-accent-green"
          onClick={() => handleSelect(toCreate())}
        >
          <h2>Create Challenge</h2>
          <p>Make a shape to play</p>
        </button>
        <button type="button" className="card home-card home-card-accent-blue" onClick={() => handleSelect(toList())}>
          <h2>My Challenges</h2>
          <p>Play saved challenges</p>
        </button>
        <button
          type="button"
          className="card home-card home-card-accent-gold"
          onClick={() => handleSelect(toShop())}
        >
          <h2>🪙 Shop</h2>
          <p>Spend your CYDI Coins</p>
        </button>
        {showGetTheApp && (
          <button type="button" className="card home-card home-card-accent-green" onClick={handleGetTheApp}>
            <h2>📱 Get the Android App</h2>
            <p>Play CYDI on your phone — free on Google Play</p>
          </button>
        )}
      </div>
    </div>
  );
}
