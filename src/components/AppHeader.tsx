import {
  playAchievementsPeekSound,
  playBackSound,
  playCoinsPeekSound,
  playLogoPeekSound,
} from "../engine/soundEngine";
import AppLogo from "./AppLogo";
import { useExplicitHome } from "../app/explicitHome";
import ChampionBadge from "./ChampionBadge";
import CoinIndicator from "./CoinIndicator";
import DailyChestButton from "./DailyChestButton";
import ShareGameButton from "./ShareGameButton";
import { SocialPointsBadge } from "./SocialPointsBadge";
import SpecialChallengeButton from "./SpecialChallengeButton";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  /**
   * Renders the Social Rank pill inside the header's status row, beside the
   * champion badge and coins.
   *
   * OPTIONAL AND OFF BY DEFAULT, so every existing caller is untouched. The two
   * social modes used to drop <SocialPointsBadge /> in as a bare sibling right
   * under the header, which left it floating alone at the far left of the page,
   * outside the composition. On the web they now hand it to the header instead;
   * Android keeps rendering it exactly where it always did.
   */
  showSocialRank?: boolean;
  onBack?: () => void;
  onNavigateToAchievements?: () => void;
  onNavigateToInstructions?: () => void;
  onNavigateToShop?: () => void;
  onNavigateToSpecialChallenge?: () => void;
  onNavigateToShapeChallenge?: () => void;
  onNavigateToHome?: () => void;
  onNavigateToSettings?: () => void;
};

export default function AppHeader({
  title,
  subtitle,
  showSocialRank = false,
  onBack,
  onNavigateToAchievements,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToShapeChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: AppHeaderProps) {
  // On the web the logo means the public home at "/"; on Android it keeps
  // meaning whatever the screen passed, which is the game's own home screen.
  const explicitHome = useExplicitHome();
  const goHome = explicitHome ?? onNavigateToHome;

  return (
    <header className="app-header">
      {onBack && (
        <button
          type="button"
          className="app-header-back"
          onClick={() => {
            playBackSound();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
      )}
      {goHome ? (
        <button
          type="button"
          className="app-logo-button"
          onClick={() => {
            playLogoPeekSound();
            goHome();
          }}
          aria-label="Go to home"
        >
          <AppLogo />
        </button>
      ) : (
        <span className="app-logo-button app-logo-static">
          <AppLogo />
        </span>
      )}
      {title && (
        <div className="app-header-text">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}
      <div className="app-header-actions">
        <ChampionBadge />
        {showSocialRank && (
          <span className="app-header-social">
            <SocialPointsBadge />
          </span>
        )}
        <CoinIndicator
          onClick={
            onNavigateToShop &&
            (() => {
              playCoinsPeekSound();
              onNavigateToShop();
            })
          }
        />
        <DailyChestButton onNavigateToShop={onNavigateToShop} onNavigateToShapeChallenge={onNavigateToShapeChallenge} />
        <SpecialChallengeButton
          onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
          onNavigateToShapeChallenge={onNavigateToShapeChallenge}
        />
        <span className="app-header-actions-break" aria-hidden="true" />
        {onNavigateToAchievements && (
          <button
            type="button"
            className="achievements-shortcut"
            onClick={() => {
              playAchievementsPeekSound();
              onNavigateToAchievements();
            }}
            aria-label="Achievements"
          >
            🏆
          </button>
        )}
        <ShareGameButton />
        {onNavigateToSettings && (
          <button
            type="button"
            className="settings-shortcut"
            onClick={onNavigateToSettings}
            aria-label="Settings"
          >
            ⚙️
          </button>
        )}
      </div>
    </header>
  );
}
