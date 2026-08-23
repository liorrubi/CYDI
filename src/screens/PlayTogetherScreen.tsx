/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import PlayTogetherRoom from "../components/multiplayer/PlayTogetherRoom";
import { createRoom, joinBlockedReason, lookupRoom } from "../multiplayer/roomApi";
import { clearRoomToken, hasRoomToken, RoomSocket } from "../multiplayer/roomSocket";
import {
  DIFFICULTY_OPTIONS,
  isRoomCode,
  MP_LIMITS,
  ROUND_COUNT_OPTIONS,
  sanitizeNickname,
  type MultiplayerDifficulty,
  type RoundCount,
} from "../multiplayer/protocol";
import type { RoomTransport } from "../multiplayer/roomTransport";
import { getPlayerName, setPlayerName } from "../services/playerProfileStore";
import { trackEvent } from "../services/analytics";
import { toHome, toSettings, toShapeChallenge } from "../app/routes";
import type { Screen } from "../types/GameMode";

type PlayTogetherScreenProps = {
  onNavigate: (screen: Screen) => void;
  /** Prefilled when the player arrived on /join/<code>. */
  initialJoinCode?: string;
};

type View = "menu" | "create" | "join";

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

export default function PlayTogetherScreen({ onNavigate, initialJoinCode }: PlayTogetherScreenProps) {
  const [view, setView] = useState<View>(initialJoinCode ? "join" : "menu");
  const [session, setSession] = useState<RoomTransport | null>(null);

  const [rounds, setRounds] = useState<RoundCount>(10);
  const [difficulty, setDifficulty] = useState<MultiplayerDifficulty>("mixed");

  const [nickname, setNickname] = useState(() => getPlayerName());
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Kept so Exit can release the right seat token after the session object is gone. */
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);

  const goHome = () => onNavigate(toHome());

  // A room owns timers; leaving the screen must not leave them running.
  useEffect(() => () => session?.close(), [session]);

  const cleanNickname = useMemo(() => sanitizeNickname(nickname), [nickname]);

  /**
   * Opens the real socket. Settings are NOT passed here: the room owns them,
   * and the host applies their choice with a `configure` frame once connected -
   * which is also how every other client learns about it.
   */
  function startSession(roomCode: string, applySettings: boolean) {
    setPlayerName(cleanNickname);
    const socket = new RoomSocket({ roomCode, nickname: cleanNickname });
    if (applySettings) {
      // Sent once the seat exists; the socket drops frames while it is not
      // open, so this waits for the first snapshot rather than firing blind.
      const stop = socket.subscribe((frame) => {
        if (frame.type !== "snapshot") return;
        stop();
        if (frame.rounds !== rounds || frame.difficulty !== difficulty) {
          socket.send({ type: "configure", rounds, difficulty });
        }
      });
    }
    setActiveRoomCode(roomCode);
    setSession(socket);
  }

  async function handleCreate() {
    if (!cleanNickname) {
      setFormError("Enter a nickname so your friends know who you are.");
      return;
    }
    setFormError(null);
    setBusy(true);
    const result = await createRoom();
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    // A freshly created code cannot have a stale seat token, and reusing one
    // from a previous room with the same code would claim someone else's seat.
    clearRoomToken(result.roomCode);
    // The room code itself is never sent - only the settings chosen for it.
    trackEvent("mp_room_created", { roundCount: rounds, difficulty });
    startSession(result.roomCode, true);
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setFormError("Enter the 6-character room code your friend shared.");
      return;
    }
    // `code.length` is read BEFORE the guard: isRoomCode narrows `unknown` to
    // `string`, which means TypeScript narrows an already-string argument to
    // `never` in the failing branch and the length is unreachable there.
    const enteredLength = code.length;
    if (!isRoomCode(code)) {
      setFormError(
        enteredLength !== MP_LIMITS.ROOM_CODE_LENGTH
          ? `Room codes are exactly ${MP_LIMITS.ROOM_CODE_LENGTH} characters - you entered ${enteredLength}.`
          : "That code contains characters we do not use. Codes never include 0, O, 1 or I.",
      );
      return;
    }
    if (!cleanNickname) {
      setFormError("Enter a nickname so the others know who you are.");
      return;
    }
    setFormError(null);
    setBusy(true);
    const lookup = await lookupRoom(code);
    setBusy(false);
    if (!lookup.ok) {
      setFormError(lookup.error);
      return;
    }
    // A held token means this is a RECONNECT, which the server allows in any
    // phase - so a started or full room is only a blocker for a genuinely new
    // player.
    const returning = hasRoomToken(code);
    const blocked = joinBlockedReason(lookup.info);
    if (blocked && !returning) {
      setFormError(blocked);
      return;
    }
    startSession(code, false);
  }

  function exitRoom() {
    // Leaving deliberately gives up the seat: keeping the token would silently
    // put the player back into a game they chose to walk away from.
    if (activeRoomCode) clearRoomToken(activeRoomCode);
    session?.close();
    setSession(null);
    setActiveRoomCode(null);
    setView("menu");
  }

  if (session) {
    return (
      <div className="screen">
        <AppHeader
          title="Play Together"
          onBack={exitRoom}
          onNavigateToHome={goHome}
          onNavigateToSettings={() => onNavigate(toSettings())}
          onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        />
        <PlayTogetherRoom transport={session} onExit={exitRoom} />
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title="Play Together"
        subtitle="Draw against your friends, live"
        onBack={view === "menu" ? goHome : () => { setView("menu"); setFormError(null); }}
        onNavigateToHome={goHome}
        onNavigateToSettings={() => onNavigate(toSettings())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
      />

      {view === "menu" && (
        <div className="mp-entry">
          <section className="mp-explainer">
            <h2 className="mp-panel-heading">How it works</h2>
            <ol className="mp-explainer-list">
              <li>
                <span className="mp-explainer-icon" aria-hidden="true">🏠</span>
                One person creates a game and shares the room code.
              </li>
              <li>
                <span className="mp-explainer-icon" aria-hidden="true">👋</span>
                Everyone else joins from a browser — no app, no account.
              </li>
              <li>
                <span className="mp-explainer-icon" aria-hidden="true">👀</span>
                You all see the same shape for 3 seconds, then draw it from memory.
              </li>
              <li>
                <span className="mp-explainer-icon" aria-hidden="true">🏆</span>
                Accuracy and speed decide the winner. Highest total takes the crown.
              </li>
            </ol>
            <p className="mp-hint">2–8 players · 5, 10 or 15 rounds · 20 seconds to draw</p>
          </section>

          <div className="mp-entry-actions">
            <button type="button" className="card mp-entry-card mp-entry-card-primary" onClick={() => setView("create")}>
              <span className="mp-entry-icon" aria-hidden="true">➕</span>
              <span className="mp-entry-title">Create Game</span>
              <span className="mp-entry-sub">Host a room and invite your friends</span>
            </button>
            <button type="button" className="card mp-entry-card" onClick={() => setView("join")}>
              <span className="mp-entry-icon" aria-hidden="true">🔑</span>
              <span className="mp-entry-title">Join Game</span>
              <span className="mp-entry-sub">Enter a room code you were given</span>
            </button>
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="mp-form">
          <label className="mp-field">
            <span className="mp-field-label">Your nickname</span>
            <input
              className="mp-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={MP_LIMITS.MAX_NICKNAME_LENGTH}
              placeholder="e.g. Lior"
              autoComplete="nickname"
            />
          </label>

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

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <Button className="mp-primary-action" onClick={handleCreate} disabled={busy}>
            {busy ? "Creating room…" : "Create Game"}
          </Button>
        </div>
      )}

      {view === "join" && (
        <div className="mp-form">
          <label className="mp-field">
            <span className="mp-field-label">Room code</span>
            <input
              className="mp-input mp-input-code"
              value={joinCode}
              // Upper-cased as you type: codes are always upper-case, and
              // silently fixing it beats rejecting someone's correct code.
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, MP_LIMITS.ROOM_CODE_LENGTH))}
              maxLength={MP_LIMITS.ROOM_CODE_LENGTH}
              placeholder="ABC123"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="mp-code-hint"
            />
            <span id="mp-code-hint" className="mp-hint">
              6 characters. Codes never contain 0, O, 1 or I.
            </span>
          </label>

          <label className="mp-field">
            <span className="mp-field-label">Your nickname</span>
            <input
              className="mp-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={MP_LIMITS.MAX_NICKNAME_LENGTH}
              placeholder="e.g. Maya"
              autoComplete="nickname"
            />
          </label>

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <Button className="mp-primary-action" onClick={handleJoin} disabled={busy}>
            {busy ? "Finding game…" : "Join Game"}
          </Button>
        </div>
      )}
    </div>
  );
}
