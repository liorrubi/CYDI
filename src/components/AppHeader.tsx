import {
  playAchievementsPeekSound,
  playBackSound,
  playCoinsPeekSound,
  playLogoPeekSound,
} from "../engine/soundEngine";
import AppLogo from "./AppLogo";
import ChampionBadge from "./ChampionBadge";
import CoinIndicator from "./CoinIndicator";
import DailyChestButton from "./DailyChestButton";
import ShareGameButton from "./ShareGameButton";
import SpecialChallengeButton from "./SpecialChallengeButton";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
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
  onBack,
  onNavigateToAchievements,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToShapeChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: AppHeaderProps) {
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
      {onNavigateToHome ? (
        <button
          type="button"
          className="app-logo-button"
          onClick={() => {
            playLogoPeekSound();
            onNavigateToHome();
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
