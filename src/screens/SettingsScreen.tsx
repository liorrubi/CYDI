import { useState } from "react";
import type { FormEvent } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import { APP_BUILD, APP_VERSION, DIFFICULTY_LEVELS, passScoreForDifficulty } from "../app/constants";
import { playChipSound } from "../engine/soundEngine";
import { getDifficulty, setDifficulty } from "../services/difficultySettings";
import { isUnlockEverythingActive, setUnlockEverything } from "../services/unlockOverrideStore";
import { exportSaveCode, importSaveCode } from "../services/saveTransfer";
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
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<"export" | "import" | null>(null);
  const [exportCode, setExportCode] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importDone, setImportDone] = useState(false);

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

  function handleOpenExport() {
    setExportCode(exportSaveCode());
    setCopyFeedback(null);
    setTransferMode("export");
  }

  async function handleCopyExportCode() {
    try {
      await navigator.clipboard.writeText(exportCode);
      setCopyFeedback("Copied!");
    } catch {
      setCopyFeedback("Couldn't copy automatically - select the text above and copy it manually.");
    }
    window.setTimeout(() => setCopyFeedback(null), 2500);
  }

  function handleOpenImport() {
    setImportText("");
    setImportError(null);
    setImportConfirmOpen(false);
    setImportDone(false);
    setTransferMode("import");
  }

  function handleRequestImport() {
    if (!importText.trim()) {
      setImportError("Paste a backup code first.");
      return;
    }
    setImportError(null);
    setImportConfirmOpen(true);
  }

  function handleConfirmImport() {
    const result = importSaveCode(importText);
    if (!result.ok) {
      setImportConfirmOpen(false);
      setImportError(result.error);
      return;
    }
    setImportDone(true);
    window.setTimeout(() => window.location.reload(), 1200);
  }

  function handleCloseTransfer() {
    setTransferMode(null);
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

      <div className="card instructions-card">
        <h2>Backup &amp; Transfer</h2>
        <p className="status-text">Move your progress to another phone, computer, or browser using a backup code.</p>
        <div className="button-row">
          <Button variant="secondary" onClick={handleOpenExport}>
            📤 Export Backup Code
          </Button>
          <Button variant="secondary" onClick={handleOpenImport}>
            📥 Restore from Code
          </Button>
        </div>
      </div>

      <div className="card instructions-card">
        <h2>Legal / Credits</h2>
        <p className="status-text">
          © 2026 Lior Rubinovich. All rights reserved.
          <br />
          Game design, code, graphics, sounds, and original content are protected by copyright.
          <br />
          Unauthorized copying, distribution, modification, or commercial use is prohibited.
        </p>
        <Button variant="secondary" onClick={() => setCreditsOpen(true)}>
          Copyright &amp; Credits
        </Button>
      </div>

      <p className="settings-version-footer">
        Version {APP_VERSION}
        <br />
        Build {APP_BUILD}
      </p>

      {creditsOpen && (
        <div className="password-prompt-overlay" onClick={() => setCreditsOpen(false)}>
          <div className="password-prompt-card credits-card" onClick={(event) => event.stopPropagation()}>
            <h2>Copyright &amp; Credits</h2>
            <p className="status-text">
              © 2026 Lior Rubinovich. All rights reserved.
              <br />
              <br />
              This game, including its original design, gameplay elements, code, graphics, sounds, icons, text, and
              other creative assets, is protected by copyright and other applicable intellectual property laws.
              <br />
              <br />
              No part of this game may be copied, modified, redistributed, republished, uploaded, sold, or used
              commercially without prior written permission.
              <br />
              <br />
              Third-party assets, libraries, fonts, icons, or sounds, if used, remain the property of their
              respective owners and are used according to their applicable licenses.
            </p>
            <Button onClick={() => setCreditsOpen(false)}>Close</Button>
          </div>
        </div>
      )}

      {transferMode === "export" && (
        <div className="password-prompt-overlay" onClick={handleCloseTransfer}>
          <div className="password-prompt-card credits-card" onClick={(event) => event.stopPropagation()}>
            <h2>Your Backup Code</h2>
            <p className="status-text">Copy this code, then paste it into Settings → Restore from Code on your other device.</p>
            <textarea
              readOnly
              className="password-prompt-input backup-code-textarea"
              value={exportCode}
              rows={6}
              onFocus={(event) => event.currentTarget.select()}
            />
            {copyFeedback && <p className="status-text">{copyFeedback}</p>}
            <div className="button-row">
              <Button variant="secondary" onClick={handleCloseTransfer}>
                Close
              </Button>
              <Button onClick={handleCopyExportCode}>Copy to Clipboard</Button>
            </div>
          </div>
        </div>
      )}

      {transferMode === "import" && (
        <div className="password-prompt-overlay" onClick={handleCloseTransfer}>
          <div className="password-prompt-card credits-card" onClick={(event) => event.stopPropagation()}>
            <h2>Restore from Code</h2>
            {importDone ? (
              <p className="status-text">Progress restored! Reloading…</p>
            ) : importConfirmOpen ? (
              <div className="reset-confirm">
                <p>This will replace all progress on this device with the backup. This cannot be undone. Continue?</p>
                <div className="button-row">
                  <Button variant="secondary" onClick={() => setImportConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={handleConfirmImport}>
                    Restore
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="status-text">Paste the backup code from your other device.</p>
                <textarea
                  autoFocus
                  className="password-prompt-input backup-code-textarea"
                  placeholder="Paste backup code here"
                  value={importText}
                  rows={6}
                  onChange={(event) => {
                    setImportText(event.target.value);
                    setImportError(null);
                  }}
                />
                {importError && <p className="form-error">{importError}</p>}
                <div className="button-row">
                  <Button variant="secondary" onClick={handleCloseTransfer}>
                    Cancel
                  </Button>
                  <Button onClick={handleRequestImport}>Restore</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
