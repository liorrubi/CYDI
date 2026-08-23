/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { playSelectSound } from "../engine/soundEngine";

export const HOME_MODES = ["classic", "passPlay", "multiplayer"] as const;
export type HomeMode = (typeof HOME_MODES)[number];

const LABELS: Record<HomeMode, string> = {
  classic: "Classic",
  passPlay: "2 Players",
  multiplayer: "Multiplayer",
};

type HomeModeTabsProps = {
  active: HomeMode;
  onSelect: (mode: HomeMode) => void;
};

/**
 * The one place that answers "who is playing" before anything else on Home.
 *
 * Deliberately NOT a `tablist`: picking 2 Players or Multiplayer navigates to
 * another screen rather than swapping a panel underneath, and announcing tabs
 * that have no tabpanel would mislead a screen reader. It is a small navigation
 * bar, so it says so - `aria-current="page"` marks where you already are, which
 * is also the only reason Classic is a button at all (tapping it from Home is a
 * no-op, and it stays tappable so the group never looks broken).
 */
export default function HomeModeTabs({ active, onSelect }: HomeModeTabsProps) {
  return (
    <nav className="home-mode-tabs" aria-label="Game modes">
      {HOME_MODES.map((mode) => {
        const isActive = mode === active;
        return (
          <button
            key={mode}
            type="button"
            className={isActive ? "home-mode-tab home-mode-tab-active" : "home-mode-tab"}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              if (isActive) return;
              playSelectSound();
              onSelect(mode);
            }}
          >
            {LABELS[mode]}
          </button>
        );
      })}
    </nav>
  );
}
