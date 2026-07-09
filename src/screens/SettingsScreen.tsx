import { useState } from "react";
import type { FormEvent } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import { APP_BUILD, APP_BUILD_TIME, APP_VERSION, DIFFICULTY_LEVELS, passScoreForDifficulty } from "../app/constants";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { playChipSound } from "../engine/soundEngine";
import { getDifficulty, setDifficulty } from "../services/difficultySettings";
import { isUnlockEverythingActive, setUnlockEverything } from "../services/unlockOverrideStore";
import { exportSaveCode, importSaveCode } from "../services/saveTransfer";
import { toAchievements, toHome, toInstructions, toShop, toSpecialChallenge } from "../app/routes";
import type { Screen } from "../types/GameMode";

const LOCK_MANAGEMENT_PASSWORD = "1111";

function formatBuildTime(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" });
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${date.getFullYear()}, ${hours}:${minutes}`;
}

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
  const [legalOpen, setLegalOpen] = useState(false);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<"export" | "import" | null>(null);
  const [exportCode, setExportCode] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importDone, setImportDone] = useState(false);

  const creditsDialogRef = useDialogA11y<HTMLDivElement>(creditsOpen, { onClose: () => setCreditsOpen(false) });
  const legalDialogRef = useDialogA11y<HTMLDivElement>(legalOpen, { onClose: () => setLegalOpen(false) });
  const accessibilityDialogRef = useDialogA11y<HTMLDivElement>(accessibilityOpen, { onClose: () => setAccessibilityOpen(false) });
  const exportDialogRef = useDialogA11y<HTMLDivElement>(transferMode === "export", { onClose: handleCloseTransfer });
  const importDialogRef = useDialogA11y<HTMLDivElement>(transferMode === "import", { onClose: handleCloseTransfer });
  const passwordDialogRef = useDialogA11y<HTMLFormElement>(passwordPromptOpen, { onClose: handleCancelLockPrompt });

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
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
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
              aria-pressed={level.id === difficulty}
            >
              {level.id === difficulty ? "✓ " : ""}
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
        <h2>Help &amp; Support</h2>
        <p className="status-text">
          Questions, bug reports, or feedback? Contact us at{" "}
          <a href="mailto:support@playcydi.com">support@playcydi.com</a>
        </p>
        <p className="status-text">
          <strong>Progress &amp; coins are saved locally on this device/browser only.</strong> Clearing browser
          data, switching devices, private browsing, technical issues, or game updates may cause progress or
          coins to be lost. CYDI Coins are virtual game points only and have no real-money value.
        </p>
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
        <div className="button-row">
          <Button variant="secondary" onClick={() => setCreditsOpen(true)}>
            Copyright &amp; Credits
          </Button>
          <Button variant="secondary" onClick={() => setLegalOpen(true)}>
            Terms &amp; Privacy
          </Button>
          <Button variant="secondary" onClick={() => setAccessibilityOpen(true)}>
            Accessibility
          </Button>
        </div>
      </div>

      <p className="settings-version-footer">
        <span className="settings-version-footer-brand">CYDI</span>
        <br />
        Can You Draw It?
        <br />
        Version {APP_VERSION} / Build {APP_BUILD}
        <br />
        Last updated: {formatBuildTime(APP_BUILD_TIME)}
      </p>

      {creditsOpen && (
        <div className="password-prompt-overlay" onClick={() => setCreditsOpen(false)}>
          <div
            ref={creditsDialogRef}
            className="password-prompt-card credits-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credits-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="credits-modal-title">Copyright &amp; Credits</h2>
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

      {legalOpen && (
        <div className="password-prompt-overlay" onClick={() => setLegalOpen(false)}>
          <div
            ref={legalDialogRef}
            className="password-prompt-card credits-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="legal-modal-title">Terms &amp; Privacy</h2>

            <h3>Disclaimer</h3>
            <p className="status-text">
              CYDI is provided as-is for entertainment purposes only. We do our best to keep the game available and
              working properly, but we do not guarantee uninterrupted availability, error-free operation, permanent
              data storage, or specific results. Scores, progress, challenges, rewards, and game mechanics may
              change, reset, or be discontinued at any time.
            </p>

            <h3>Terms of Use</h3>
            <ul className="status-text legal-list">
              <li>CYDI is intended for entertainment purposes only.</li>
              <li>Bots, hacking, score manipulation, harassment, or abuse of sharing features are not allowed.</li>
              <li>We may change, update, restrict, or discontinue the game or any part of it at any time.</li>
              <li>Our liability is limited to the extent permitted by law.</li>
            </ul>

            <h3>Privacy Policy</h3>
            <ul className="status-text legal-list">
              <li>
                <strong>Stored on your device:</strong> your game progress, scores, achievements, unlocked shapes,
                difficulty setting, sound preference, and an anonymous, randomly generated player ID and display
                name, all saved in your browser's local storage.
              </li>
              <li>
                <strong>Stored on our server (Cloudflare):</strong> if you play the Daily Challenge or use sharing
                features, we store your anonymous player ID, display name, score, and the relevant challenge/shape
                ID - nothing more. If you set a display name, it appears on the public Daily Challenge leaderboard
                together with your score, visible to other players.
              </li>
              <li>No real name is ever required. The display name is optional and can be anything you choose.</li>
              <li>We do not intentionally collect sensitive personal information.</li>
              <li>
                As with any website, Cloudflare (our hosting provider) processes basic connection data such as IP
                address at the network level to deliver requests. CYDI itself does not read, log, or store this
                information.
              </li>
              <li>
                CYDI does not currently use analytics or tracking tools. If that changes, this policy will be
                updated first.
              </li>
            </ul>

            <h3>Development Status &amp; Virtual Coins</h3>
            <ul className="status-text legal-list">
              <li>CYDI is still in active development, and features, balancing, and content may change.</li>
              <li>
                CYDI Coins are virtual in-game points only. They have no real-world monetary value and cannot be
                exchanged, redeemed, or converted into real money or any other form of currency.
              </li>
              <li>
                Progress and coins are saved locally on your device/browser only. At this stage, we make no
                commitment to restore progress or coins lost due to clearing local data, switching devices,
                technical issues, or game/version updates.
              </li>
            </ul>

            <h3>Children</h3>
            <p className="status-text">
              CYDI does not ask children, or any player, to provide personal information. The default display name
              is "Anonymous Player," and choosing a different name is entirely optional.
            </p>
            <p className="status-text">
              If ads, user accounts, or in-app purchases are added in the future, this policy will be updated before
              release.
            </p>

            <h3>Contact</h3>
            <p className="status-text">
              Privacy questions: <a href="mailto:privacy@playcydi.com">privacy@playcydi.com</a>
            </p>

            <Button onClick={() => setLegalOpen(false)}>Close</Button>
          </div>
        </div>
      )}

      {accessibilityOpen && (
        <div className="password-prompt-overlay" onClick={() => setAccessibilityOpen(false)}>
          <div
            ref={accessibilityDialogRef}
            className="password-prompt-card credits-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="accessibility-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="accessibility-modal-title">Accessibility</h2>
            <p className="status-text">
              We're actively working to make CYDI more accessible, and this is an ongoing effort rather than a
              finished one. Feedback on what still needs improvement is welcome.
            </p>

            <h3>What's supported today</h3>
            <ul className="status-text legal-list">
              <li>
                Keyboard navigation for menus, buttons, settings, and dialogs - Tab / Shift+Tab to move between
                controls, Enter or Space to activate them, and Escape to close dialogs.
              </li>
              <li>Descriptive labels on icon-only buttons for screen readers.</li>
              <li>Color-contrast-checked text, and states that are never conveyed by color alone.</li>
              <li>Large touch targets, especially on mobile.</li>
            </ul>

            <h3>Known limitation</h3>
            <p className="status-text">
              The core drawing gameplay is a freehand pointer/touch interaction - drawing a shape with a mouse,
              finger, or stylus - and does not currently have a full keyboard alternative.
            </p>

            <h3>Report a problem</h3>
            <p className="status-text">
              Found an accessibility issue, or have a suggestion? Contact us at{" "}
              <a href="mailto:support@playcydi.com">support@playcydi.com</a>.
            </p>

            <Button onClick={() => setAccessibilityOpen(false)}>Close</Button>
          </div>
        </div>
      )}

      {transferMode === "export" && (
        <div className="password-prompt-overlay" onClick={handleCloseTransfer}>
          <div
            ref={exportDialogRef}
            className="password-prompt-card credits-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="export-modal-title">Your Backup Code</h2>
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
          <div
            ref={importDialogRef}
            className="password-prompt-card credits-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="import-modal-title">Restore from Code</h2>
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
          <form
            ref={passwordDialogRef}
            className="password-prompt-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-modal-title"
            onSubmit={handleConfirmLockPassword}
          >
            <h2 id="password-modal-title">Enter Password</h2>
            <input
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
