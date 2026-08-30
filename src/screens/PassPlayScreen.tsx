/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { Suspense, lazy, useCallback, useState } from "react";
import { Capacitor } from "@capacitor/core";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import PassPlayGame, { type PassPlayProgress } from "../components/passplay/PassPlayGame";
import { SocialPointsBadge } from "../components/SocialPointsBadge";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { trackEvent } from "../services/analytics";
import { getPlayerName, setPlayerName } from "../services/playerProfileStore";
import { DIFFICULTY_OPTIONS, ROUND_COUNT_OPTIONS, type MultiplayerDifficulty, type RoundCount } from "../multiplayer/protocol";
import { cleanPlayerName, duplicateNameIndex, PASS_PLAY_LIMITS, type PassPlaySetup } from "../passplay/passPlayGame";
import { toHome, toPassPlay, toSettings, toShapeChallenge, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";

type PassPlayScreenProps = {
  onNavigate: (screen: Screen) => void;
};

const DIFFICULTY_LABELS: Record<MultiplayerDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  mixed: "Mixed",
};

const DIFFICULTY_HINTS: Record<MultiplayerDifficulty, string> = {
  easy: "Simple lines and everyday symbols",
  medium: "Recognisable objects with a bit of detail",
  hard: "Animals, vehicles and intricate scenes",
  mixed: "A bit of everything",
};

/**
 * Two players, one device.
 *
 * The setup form collects a name per seat and then hands a plain
 * `PassPlaySetup` to the game, which owns everything else. Names live in a
 * `string[]` rather than two fields for the same reason the engine does:
 * raising the cap to three or four is then a change to this array and the
 * validation below, and nothing else.
 */
/**
 * The web's 2 Players entry (art direction 3a). Lazy and web-only: Android never
 * takes this branch, so the chunk is never requested and the existing form
 * renders exactly as before.
 *
 * Fully controlled by this screen - it holds no pass-play state of its own.
 */
const PassPlayEntry = lazy(() => import("../site/PassPlayEntry"));

export default function PassPlayScreen({ onNavigate }: PassPlayScreenProps) {
  const [setup, setSetup] = useState<PassPlaySetup | null>(null);
  // Seat 1 is prefilled with whatever name this device already plays under;
  // seat 2 is the guest and is nearly always somebody different.
  const [names, setNames] = useState<string[]>(() => [getPlayerName(), ""]);
  const [rounds, setRounds] = useState<RoundCount>(10);
  const [difficulty, setDifficulty] = useState<MultiplayerDifficulty>("mixed");
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PassPlayProgress | null>(null);
  /** The navigation the player asked for, held while the "Quit game?" confirmation is up. */
  const [pendingExit, setPendingExit] = useState<{ run: () => void } | null>(null);

  const goHome = () => onNavigate(toHome());

  // Identity-stable so it does not re-fire the game's reporting effect on every
  // render of this screen.
  const handleProgress = useCallback((next: PassPlayProgress) => setProgress(next), []);

  /**
   * Every way out of a running match goes through here.
   *
   * A match cannot be paused or resumed - there is no server holding it - so
   * leaving really does destroy it, and that deserves a question. Setup and the
   * finished champion screen have nothing to lose, so they are not guarded.
   */
  function leave(run: () => void) {
    if (progress?.active) setPendingExit({ run });
    else run();
  }

  function confirmQuit() {
    if (progress) {
      trackEvent("pp_abandoned", {
        roundIndex: progress.roundIndex,
        playerCount: progress.playerCount,
        roundCount: progress.rounds,
      });
    }
    const action = pendingExit?.run;
    setPendingExit(null);
    setProgress(null);
    action?.();
  }

  function updateName(seat: number, value: string) {
    setNames((current) => current.map((name, i) => (i === seat ? value : name)));
  }

  function handleStart() {
    const duplicate = duplicateNameIndex(names);
    if (duplicate >= 0) {
      setFormError("Both players need different names — otherwise the scores are impossible to tell apart.");
      return;
    }
    setFormError(null);
    // Seat 1 is this device's player, so a name typed here is worth keeping for
    // the next game and for Play Together.
    const first = names[0].trim();
    if (first) setPlayerName(first);
    setSetup({ names: names.map((name, seat) => cleanPlayerName(name, seat)), rounds, difficulty });
  }

  /*
   * Web-only header wiring for the two consistency fixes.
   *
   *  socialRankInHeader  the Social Rank pill moves into the header's status
   *                      row instead of floating alone under it. Presentation
   *                      only - the badge, and every bit of Social Rank logic
   *                      behind it, is the same component either way.
   *
   *  shopFromHere        the coin pill is the shop shortcut everywhere else in
   *                      the game (AppHeader turns CoinIndicator into a button
   *                      exactly when it is given this). Leaving it out here is
   *                      what made an identical-looking control dead on this
   *                      screen, so the web now passes it too.
   *
   * Android is untouched: both are undefined there, so the header renders the
   * plain coin span and the badge stays where it has always been.
   */
  const onWeb = !Capacitor.isNativePlatform();
  const shopFromHere = onWeb ? () => onNavigate(toShop(toPassPlay())) : undefined;

  if (setup) {
    const backToSetup = () => {
      setProgress(null);
      setSetup(null);
    };
    return (
      <div className="screen">
        <AppHeader
          title="2 Players"
          showSocialRank={onWeb}
          onBack={() => leave(backToSetup)}
          onNavigateToHome={() => leave(goHome)}
          onNavigateToSettings={() => leave(() => onNavigate(toSettings()))}
          onNavigateToShapeChallenge={() => leave(() => onNavigate(toShapeChallenge()))}
        />
        {!onWeb && <SocialPointsBadge />}
        <PassPlayGame setup={setup} onExit={backToSetup} onProgress={handleProgress} />
        {pendingExit && <QuitConfirmation onKeepPlaying={() => setPendingExit(null)} onQuit={confirmQuit} />}
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title="2 Players"
        subtitle="Take turns on this device"
        showSocialRank={onWeb}
        onBack={goHome}
        onNavigateToHome={goHome}
        onNavigateToShop={shopFromHere}
        onNavigateToSettings={() => onNavigate(toSettings())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
      />
      {!onWeb && <SocialPointsBadge />}

      {/* The web gets the 3a composition; Android keeps the form below,
          unchanged. Both drive the same state and the same handleStart. */}
      {!Capacitor.isNativePlatform() && (
        <Suspense fallback={<div className="mp-form" />}>
          <PassPlayEntry
            names={names}
            onNameChange={updateName}
            maxNameLength={PASS_PLAY_LIMITS.MAX_NAME_LENGTH}
            rounds={rounds}
            roundOptions={ROUND_COUNT_OPTIONS}
            onRounds={(count) => setRounds(count as RoundCount)}
            difficulty={difficulty}
            difficultyOptions={DIFFICULTY_OPTIONS}
            difficultyLabel={(option) => DIFFICULTY_LABELS[option as MultiplayerDifficulty]}
            difficultyHint={DIFFICULTY_HINTS[difficulty]}
            onDifficulty={(option) => setDifficulty(option as MultiplayerDifficulty)}
            formError={formError}
            onStart={handleStart}
          />
        </Suspense>
      )}

      {Capacitor.isNativePlatform() && (
      <div className="mp-form">
        <section className="mp-explainer">
          <h2 className="mp-panel-heading">How it works</h2>
          <ol className="mp-explainer-list">
            <li>
              <span className="mp-explainer-icon" aria-hidden="true">📱</span>
              One device. You take your turns one after the other.
            </li>
            <li>
              <span className="mp-explainer-icon" aria-hidden="true">👀</span>
              The same shape each round — 3 seconds to look, 20 to draw it.
            </li>
            <li>
              <span className="mp-explainer-icon" aria-hidden="true">🤝</span>
              No scores until you have both drawn, so nobody has a target to beat.
            </li>
            <li>
              <span className="mp-explainer-icon" aria-hidden="true">🏆</span>
              Accuracy and speed both count. Highest total takes the crown.
            </li>
          </ol>
        </section>

        <fieldset className="mp-fieldset">
          <legend className="mp-legend">Players</legend>
          {names.map((name, seat) => (
            <label className="mp-field" key={seat}>
              <span className="mp-field-label">Player {seat + 1}</span>
              <input
                className="mp-input"
                value={name}
                onChange={(e) => updateName(seat, e.target.value)}
                maxLength={PASS_PLAY_LIMITS.MAX_NAME_LENGTH}
                placeholder={seat === 0 ? "e.g. Maya" : "e.g. Tom"}
                autoComplete="off"
              />
            </label>
          ))}
        </fieldset>

        <fieldset className="mp-fieldset">
          <legend className="mp-legend">Rounds</legend>
          <div className="mp-chip-row">
            {ROUND_COUNT_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                className={count === rounds ? "mp-chip mp-chip-active" : "mp-chip"}
                aria-pressed={count === rounds}
                onClick={() => setRounds(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mp-fieldset">
          <legend className="mp-legend">Difficulty</legend>
          <div className="mp-chip-row">
            {DIFFICULTY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === difficulty ? "mp-chip mp-chip-active" : "mp-chip"}
                aria-pressed={option === difficulty}
                onClick={() => setDifficulty(option)}
              >
                {DIFFICULTY_LABELS[option]}
              </button>
            ))}
          </div>
          <p className="mp-hint">{DIFFICULTY_HINTS[difficulty]}</p>
        </fieldset>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <Button className="mp-primary-action" onClick={handleStart}>
          Start Game
        </Button>
      </div>
      )}
    </div>
  );
}

type QuitConfirmationProps = {
  onKeepPlaying: () => void;
  onQuit: () => void;
};

/** Escape and the backdrop both mean "keep playing" - the safe answer is the easy one to reach by accident. */
function QuitConfirmation({ onKeepPlaying, onQuit }: QuitConfirmationProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onKeepPlaying });
  return (
    <div className="onboarding-overlay" role="presentation" onClick={onKeepPlaying}>
      <div
        ref={dialogRef}
        className="password-prompt-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pp-quit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="pp-quit-title">Quit game?</h2>
        <p className="status-text">Your current match progress will be lost.</p>
        <div className="button-row">
          <Button onClick={onKeepPlaying}>Keep Playing</Button>
          <Button variant="secondary" onClick={onQuit}>
            Quit Game
          </Button>
        </div>
      </div>
    </div>
  );
}
