/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import PassPlayGame from "../components/passplay/PassPlayGame";
import { getPlayerName, setPlayerName } from "../services/playerProfileStore";
import { DIFFICULTY_OPTIONS, ROUND_COUNT_OPTIONS, type MultiplayerDifficulty, type RoundCount } from "../multiplayer/protocol";
import { cleanPlayerName, duplicateNameIndex, PASS_PLAY_LIMITS, type PassPlaySetup } from "../passplay/passPlayGame";
import { toHome, toSettings, toShapeChallenge } from "../app/routes";
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
export default function PassPlayScreen({ onNavigate }: PassPlayScreenProps) {
  const [setup, setSetup] = useState<PassPlaySetup | null>(null);
  // Seat 1 is prefilled with whatever name this device already plays under;
  // seat 2 is the guest and is nearly always somebody different.
  const [names, setNames] = useState<string[]>(() => [getPlayerName(), ""]);
  const [rounds, setRounds] = useState<RoundCount>(10);
  const [difficulty, setDifficulty] = useState<MultiplayerDifficulty>("mixed");
  const [formError, setFormError] = useState<string | null>(null);

  const goHome = () => onNavigate(toHome());

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

  if (setup) {
    return (
      <div className="screen">
        <AppHeader
          title="2 Players"
          onBack={() => setSetup(null)}
          onNavigateToHome={goHome}
          onNavigateToSettings={() => onNavigate(toSettings())}
          onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        />
        <PassPlayGame setup={setup} onExit={() => setSetup(null)} />
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title="2 Players"
        subtitle="Take turns on this device"
        onBack={goHome}
        onNavigateToHome={goHome}
        onNavigateToSettings={() => onNavigate(toSettings())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
      />

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
    </div>
  );
}
