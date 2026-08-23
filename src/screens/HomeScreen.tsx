import AppHeader from "../components/AppHeader";
import FeaturedShapePreviews from "../components/FeaturedShapePreviews";
import HomeModeTabs, { type HomeMode } from "../components/HomeModeTabs";
import { APP_NAME, APP_TAGLINE } from "../app/constants";
import {
  toAchievements,
  toCreate,
  toDailyChallenge,
  toHome,
  toInstructions,
  toList,
  toPassPlay,
  toPlayTogether,
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

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  function handleSelect(screen: Screen) {
    playSelectSound();
    onNavigate(screen);
  }

  /**
   * The mode switch navigates rather than swapping content: 2 Players and
   * Multiplayer are whole screens that already exist, and the brief was
   * explicit that there is no intermediate page between the tab and the game.
   * Classic is therefore always the selected tab here, because Home IS Classic.
   */
  function handleMode(mode: HomeMode) {
    if (mode === "passPlay") onNavigate(toPassPlay());
    if (mode === "multiplayer") onNavigate(toPlayTogether());
  }

  // Hidden inside the Android app itself, where "get the app" is meaningless -
  // this is the website's install CTA only.
  const showGetTheApp = !isAndroidApp();

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
      <HomeModeTabs active="classic" onSelect={handleMode} />
      <div className="home-cards">
        <button
          type="button"
          className="card home-card home-card-accent-purple home-card-featured"
          onClick={() => handleSelect(toShapeChallenge())}
        >
          <h2>Shape Challenge</h2>
          <p>Draw what the game shows you</p>
          <FeaturedShapePreviews />
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
          className="card home-card home-card-accent-pink"
          onClick={() => handleSelect(toPlayTogether())}
        >
          <h2>Play Together</h2>
          <p>Draw against friends, live &mdash; 2 to 8 players</p>
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
