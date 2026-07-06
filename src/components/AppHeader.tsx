import { APP_NAME } from "../app/constants";
import { playAchievementsPeekSound, playBackSound, playInfoPeekSound } from "../engine/soundEngine";
import CoinIndicator from "./CoinIndicator";
import SoundToggleButton from "./SoundToggleButton";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  onNavigateToAchievements?: () => void;
  onNavigateToInstructions?: () => void;
};

export default function AppHeader({
  title = APP_NAME,
  subtitle,
  onBack,
  onNavigateToAchievements,
  onNavigateToInstructions,
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
      <div className="app-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="app-header-actions">
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
        <CoinIndicator />
        <SoundToggleButton />
      </div>
    </header>
  );
}
