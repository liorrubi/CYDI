import { APP_NAME } from "../app/constants";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
};

export default function AppHeader({ title = APP_NAME, subtitle, onBack }: AppHeaderProps) {
  return (
    <header className="app-header">
      {onBack && (
        <button type="button" className="app-header-back" onClick={onBack} aria-label="Back">
          ←
        </button>
      )}
      <div className="app-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </header>
  );
}
