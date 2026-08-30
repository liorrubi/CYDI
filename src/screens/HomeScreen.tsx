import { lazy, Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import AppHeader from "../components/AppHeader";
import FeaturedShapePreviews from "../components/FeaturedShapePreviews";
import HomeModeTabs, { type HomeMode } from "../components/HomeModeTabs";
import ResumeGameBanner from "../components/ResumeGameBanner";
import { APP_NAME, APP_TAGLINE } from "../app/constants";
import {
  toAchievements,
  toCreate,
  toDailyChallenge,
  toHome,
  toInstructions,
  toList,
  toPassPlay,
  toPlay,
  toPlayTogether,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import { shareChallenge } from "../services/challengeShare";
import { playSelectSound } from "../engine/soundEngine";
import { trackEvent } from "../services/analytics";
import { isAndroidApp, PLAY_STORE_URL } from "../services/nativeShare";
import type { Screen } from "../types/GameMode";

/*
 * The approved 5b Game Hub, web only and split out of the main bundle so none
 * of it ships to Android. HomeScreen keeps owning every destination; the hub is
 * presentation over the handlers below.
 */
const GameHub = lazy(() => import("../site/GameHub"));

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
    trackEvent("game_mode_selected", { mode: mode === "passPlay" ? "twoPlayers" : mode });
    if (mode === "passPlay") onNavigate(toPassPlay());
    if (mode === "multiplayer") onNavigate(toPlayTogether());
    /*
     * Classic is a real destination on the web. It used to be a no-op because
     * Home WAS Classic; since the site took "/" and Classic moved to its own
     * "/play/classic", the hub is not Classic and the tab has to go there - App
     * .tsx's navigate() moves the address with it. Android is unchanged: it
     * still passes active="classic", so the tab is current and never fires.
     */
    if (mode === "classic" && onWeb) onNavigate(toShapeChallenge());
  }

  // Hidden inside the Android app itself, where "get the app" is meaningless -
  // this is the website's install CTA only.
  const showGetTheApp = !isAndroidApp();

  /*
   * The web gets the 5b Game Hub; Android keeps the card list below, unchanged.
   * Both are driven by the same handlers and the same routes - this is a
   * presentation swap, not a second implementation of the menu.
   */
  const onWeb = !Capacitor.isNativePlatform();

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
      <HomeModeTabs active={onWeb ? null : "classic"} onSelect={handleMode} />
      {/* Only renders once the room has been confirmed still live. */}
      <ResumeGameBanner onResume={(roomCode) => handleSelect(toPlayTogether(roomCode))} />
      {onWeb && (
        <Suspense fallback={<div className="home-cards" />}>
          <GameHub
            onPlayClassic={() => handleSelect(toShapeChallenge())}
            onDailyChallenge={() => handleSelect(toDailyChallenge())}
            onCreate={() => handleSelect(toCreate())}
            onMyChallenges={() => handleSelect(toList())}
            onPlayChallenge={(challengeId) => handleSelect(toPlay(challengeId, toHome()))}
            /* The canonical share, not a hub-local copy of it. */
            onShareChallenge={shareChallenge}
            onShop={() => handleSelect(toShop(toHome()))}
            onAchievements={() => handleSelect(toAchievements(toHome()))}
          />
        </Suspense>
      )}
      {!onWeb && (
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
        {/*
        Web-only, and below the cards on purpose: it is a short orientation
        block with real internal links for the two social modes, not another
        entry point competing with the selector above. Hidden in the Android
        app, where crawlable links mean nothing and the tabs are right there.
      */}
      {showGetTheApp && (
        <section className="home-ways" aria-labelledby="home-ways-heading">
          <h2 id="home-ways-heading">Play CYDI your way</h2>
          <ul>
            <li>
              <strong>Classic</strong> — draw a shape from memory on your own and get it scored out of 100.{" "}
              <a href="/draw-shapes-online">Draw shapes online</a>
            </li>
            <li>
              <strong>2 Players</strong> — take turns on one phone and compare both drawings afterwards.{" "}
              <a href="/2-player-drawing-game-one-phone">2 player drawing game on one phone</a>
            </li>
            <li>
              <strong>Multiplayer</strong> — two to eight people draw the same shape at once, on their own devices.{" "}
              <a href="/multiplayer-drawing-game">Multiplayer drawing game</a>
            </li>
          </ul>
        </section>
      )}

      {showGetTheApp && (
          <button type="button" className="card home-card home-card-accent-green" onClick={handleGetTheApp}>
            <h2>📱 Get the Android App</h2>
            <p>Play CYDI on your phone — free on Google Play</p>
          </button>
        )}
      </div>
      )}
    </div>
  );
}
