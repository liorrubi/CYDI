import { useState } from "react";
import type { FormEvent } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import { DIFFICULTY_LEVELS, passScoreForDifficulty } from "../app/constants";
import { playChipSound } from "../engine/soundEngine";
import { getDifficulty, setDifficulty } from "../services/difficultySettings";
import { isUnlockEverythingActive, setUnlockEverything } from "../services/unlockOverrideStore";
import { toAchievements, toHome, toInstructions, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";

const LOCK_MANAGEMENT_PASSWORD = "1111";

type SettingsScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function SettingsScreen({ onNavigate }: SettingsScreenProps) {
  const [difficulty, setDifficultyState] = useState(() => getDifficulty());
  const [allUnlocked, setAllUnlockedState] = useState(() => isUnlockEverythingActive());
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function handleSelectDifficulty(level: (typeof DIFFICULTY_LEVELS)[number]["id"]) {
    playChipSound();
    setDifficulty(level);
    setDifficultyState(level);
  }

  function handleOpenLockPrompt() {
    setPassword("");
    setPasswordError(null);
    setPasswordPromptOpen(true);
  }

  function handleCancelLockPrompt() {
    setPasswordPromptOpen(false);
  }

  function handleConfirmLockPassword(event: FormEvent) {
    event.preventDefault();
    if (password !== LOCK_MANAGEMENT_PASSWORD) {
      setPasswordError("Incorrect password.");
      return;
    }
    const next = !allUnlocked;
    setUnlockEverything(next);
    setAllUnlockedState(next);
    playChipSound();
    setPasswordPromptOpen(false);
  }

  return (
    <div className="screen">
      <AppHeader
        title="Settings"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toHome()))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toHome()))}
        onNavigateToShop={() => onNavigate(toShop(toHome()))}
        onNavigateToHome={() => onNavigate(toHome())}
      />

      <div className="card instructions-card">
        <h2>Difficulty Level</h2>
        <p className="status-text">Choose how accurately you need to draw to pass a shape.</p>
        <div className="difficulty-picker-options">
          {DIFFICULTY_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              className={level.id === difficulty ? "difficulty-chip difficulty-chip-selected" : "difficulty-chip"}
              onClick={() => handleSelectDifficulty(level.id)}
            >
              {level.icon} {level.name}
            </button>
          ))}
        </div>
        <p className="difficulty-picker-hint">Pass score: {passScoreForDifficulty(difficulty)}+</p>
      </div>

      <div className="card instructions-card">
        <h2>Lock Management</h2>
        <p className="status-text">
          {allUnlocked ? "All categories and shapes are unlocked." : "Categories and shapes are locked as normal."}
        </p>
        <Button variant="secondary" onClick={handleOpenLockPrompt}>
          {allUnlocked ? "🔓 Re-lock Everything" : "🔒 Unlock Everything"}
        </Button>
      </div>

      {passwordPromptOpen && (
        <div className="password-prompt-overlay">
          <form className="password-prompt-card" onSubmit={handleConfirmLockPassword}>
            <h2>Enter Password</h2>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              placeholder="Password"
              className="password-prompt-input"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
              }}
            />
            {passwordError && <p className="form-error">{passwordError}</p>}
            <div className="button-row">
              <Button type="button" variant="secondary" onClick={handleCancelLockPrompt}>
                Cancel
              </Button>
              <Button type="submit">Confirm</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
