import { lazy, Suspense, type ReactNode } from "react";
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
import { CreateIcon, DailyIcon, GroupIcon, SavedIcon, ShopIcon, TwoPlayersIcon } from "../app/appIcons";
import { getProgress } from "../services/shapeChallengeProgress";
import { getChallenges } from "../services/challengeStorage";
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

/*
 * Version B replaced Version A's abstract glyphs with drawings of the actual
 * thing, which is read without being learned. Classic keeps the real shape
 * previews - it is the one mode whose art can BE the product.
 */
const MODE_ICON: Record<string, ReactNode> = {
  passPlay: <TwoPlayersIcon size={26} />,
  multiplayer: <GroupIcon size={26} />,
};

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

  /*
   * The three modes, for the Android home screen.
   *
   * They replace a 40px tab strip that named the modes and explained none of
   * them. Each card IS the action - it goes straight into the mode, with no
   * intermediate landing and no second CTA - and each calls exactly the handler
   * that surface already used, so destinations and analytics are unchanged:
   * Classic reuses the old "Shape Challenge" card's handleSelect, and the other
   * two reuse handleMode, which is what the tabs fired.
   *
   * Copy is one line each, because the whole point is to be understood without
   * reading. Web is untouched: this array is only consumed in the native branch.
   */
  const MODES: { id: HomeMode; name: string; sub: string; go: () => void }[] = [
    {
      id: "classic",
      name: "Classic",
      sub: "Solo · the core CYDI challenge",
      go: () => handleSelect(toShapeChallenge()),
    },
    { id: "passPlay", name: "2 Players", sub: "Two players · one device", go: () => handleMode("passPlay") },
    {
      id: "multiplayer",
      name: "Multiplayer",
      sub: "2–8 players · separate devices",
      go: () => handleMode("multiplayer"),
    },
  ];

  // Hidden inside the Android app itself, where "get the app" is meaningless -
  // this is the website's install CTA only.
  const showGetTheApp = !isAndroidApp();

  /*
   * The web gets the 5b Game Hub; Android keeps the card list below, unchanged.
   * Both are driven by the same handlers and the same routes - this is a
   * presentation swap, not a second implementation of the menu.
   */
  const onWeb = !Capacitor.isNativePlatform();

  /*
   * The two figures Version B puts on Home, from their real sources. Both are
   * synchronous reads of already-loaded save data, so Home still paints in one
   * pass - the speed principle from Version A.
   *
   * Version B also shows a Daily "Not played" state. That answer only exists
   * on the server (the episode's own `yourBest`), so putting it here would make
   * Home wait on a fetch. It is deliberately omitted rather than faked.
   */
  const bestScores = onWeb ? [] : Object.values(getProgress().bestScores);
  const personalBest = bestScores.length > 0 ? Math.max(...bestScores) : null;
  const savedChallenges = onWeb ? 0 : getChallenges().length;

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
      {/* The tab strip stays on the web, where the 5b hub sits under it. On
          Android the mode cards below replace it outright. */}
      {onWeb && <HomeModeTabs active={null} onSelect={handleMode} />}
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
      <>
      {/* The three modes, first and largest. */}
      <div className="app-modes">
        {MODES.map((mode) => (
          <button
            type="button"
            key={mode.id}
            className={`app-mode app-mode-${mode.id}`}
            onClick={mode.go}
          >
            <span className="app-mode-art" aria-hidden="true">
              {mode.id === "classic" ? <FeaturedShapePreviews /> : MODE_ICON[mode.id]}
            </span>
            <span className="app-mode-text">
              <span className="app-mode-name">{mode.name}</span>
              <span className="app-mode-sub">{mode.sub}</span>
              {/* Real value or nothing at all - never a placeholder zero. */}
              {mode.id === "classic" && personalBest !== null && (
                <span className="app-mode-best">Best {personalBest}</span>
              )}
            </span>
            <span className="app-mode-go" aria-hidden="true">
              &rsaquo;
            </span>
          </button>
        ))}
      </div>

      {/* Everything else keeps its existing destination and behaviour; it just
          stops competing with the modes for first place. */}
      <p className="app-more-label">More</p>
      {/* Version B's 2x2 of compact tiles. Same four destinations, same
          handlers - only the presentation is denser, so all four fit above the
          fold instead of becoming a scroll. */}
      <div className="app-more-grid">
        <button type="button" className="app-tile" onClick={() => handleSelect(toDailyChallenge())}>
          <span className="app-tile-icon app-tile-icon-daily">
            <DailyIcon />
          </span>
          <span className="app-tile-text">
            <span className="app-tile-name">Daily</span>
            <span className="app-tile-sub">One shape a day</span>
          </span>
        </button>
        <button type="button" className="app-tile" onClick={() => handleSelect(toCreate())}>
          <span className="app-tile-icon app-tile-icon-create">
            <CreateIcon />
          </span>
          <span className="app-tile-text">
            <span className="app-tile-name">Create</span>
            <span className="app-tile-sub">Your shape</span>
          </span>
        </button>
        <button type="button" className="app-tile" onClick={() => handleSelect(toList())}>
          <span className="app-tile-icon app-tile-icon-saved">
            <SavedIcon />
          </span>
          <span className="app-tile-text">
            <span className="app-tile-name">My Challenges</span>
            <span className="app-tile-sub">
              {savedChallenges > 0 ? `${savedChallenges} saved` : "None yet"}
            </span>
          </span>
        </button>
        <button type="button" className="app-tile" onClick={() => handleSelect(toShop())}>
          <span className="app-tile-icon app-tile-icon-shop">
            <ShopIcon />
          </span>
          <span className="app-tile-text">
            <span className="app-tile-name">Shop</span>
            <span className="app-tile-sub">Pens &amp; ink</span>
          </span>
        </button>
      </div>
      <div className="home-cards app-more">
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
      </>
      )}
    </div>
  );
}
