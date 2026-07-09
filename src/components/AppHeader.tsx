import {
  playAchievementsPeekSound,
  playBackSound,
  playCoinsPeekSound,
  playInfoPeekSound,
  playLogoPeekSound,
} from "../engine/soundEngine";
import AppLogo from "./AppLogo";
import CoinIndicator from "./CoinIndicator";
import DailyChestButton from "./DailyChestButton";
import SoundToggleButton from "./SoundToggleButton";
import SpecialChallengeButton from "./SpecialChallengeButton";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  onNavigateToAchievements?: () => void;
  onNavigateToInstructions?: () => void;
  onNavigateToShop?: () => void;
  onNavigateToSpecialChallenge?: () => void;
  onNavigateToHome?: () => void;
  onNavigateToSettings?: () => void;
};

export default function AppHeader({
  title,
  subtitle,
  onBack,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
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
        <CoinIndicator
          onClick={
            onNavigateToShop &&
            (() => {
              playCoinsPeekSound();
              onNavigateToShop();
            })
          }
        />
        <DailyChestButton onNavigateToShop={onNavigateToShop} />
        <SpecialChallengeButton onNavigateToSpecialChallenge={onNavigateToSpecialChallenge} />
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
        <SoundToggleButton />
        {onNavigateToInstructions && (
          <button
            type="button"
            className="info-shortcut"
            onClick={() => {
              playInfoPeekSound();
              onNavigateToInstructions();
            }}
            aria-label="How to play"
          >
            i
          </button>
        )}
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
