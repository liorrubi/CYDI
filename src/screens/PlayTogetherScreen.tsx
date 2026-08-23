/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import PlayTogetherRoom from "../components/multiplayer/PlayTogetherRoom";
import { SocialPointsBadge } from "../components/SocialPointsBadge";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { registerNavigationGuard } from "../app/navigationGuard";
import { clearActiveRoom, rememberActiveRoom } from "../multiplayer/resumeStore";
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
  /** True while there is a game in progress worth protecting from an accidental exit. */
  const [matchActive, setMatchActive] = useState(false);
  /** The navigation being held back while the "Leave game?" question is on screen. */
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);

  const handleActiveChange = useCallback((active: boolean) => setMatchActive(active), []);

  const goHome = () => onNavigate(toHome());

  /**
   * Arriving with a code we already hold a seat token for is a RESUME, not a
   * join: the server allows a token-bearing reconnect in any phase, so there is
   * nothing to ask and no form to fill in. A /join/<code> invite from someone
   * else has no token and still lands on the form.
   */
  useEffect(() => {
    if (!initialJoinCode || session) return;
    if (!isRoomCode(initialJoinCode) || !hasRoomToken(initialJoinCode)) return;
    startSession(initialJoinCode, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A room owns timers; leaving the screen must not leave them running.
  useEffect(() => () => session?.close(), [session]);

  const cleanNickname = useMemo(() => sanitizeNickname(nickname), [nickname]);

  /**
   * Opens the real socket. Settings are NOT passed here: the room owns them,
   * and the host applies their choice with a `configure` frame once connected -
   * which is also how every other client learns about it.
   */
  /**
   * Watches a RESUME attempt to its conclusion.
   *
   * Success is a real snapshot, not merely an open socket. Failure is only
   * reported for a terminal server refusal - the socket retries a dropped
   * connection on its own, and a retry in progress is not a failed resume.
   */
  function watchResume(socket: RoomSocket) {
    let settled = false;
    const stop = socket.subscribe((frame) => {
      if (settled) return;
      if (frame.type === "snapshot") {
        settled = true;
        stop();
        trackEvent("mp_resume_success", {});
        return;
      }
      // The two terminal refusals: the room is gone, or the seat cannot be had.
      // Everything else the server can say is recoverable, and a dropped
      // connection never reaches here at all - the socket retries it silently.
      if (frame.type === "error" && (frame.code === "room_closed" || frame.code === "room_full")) {
        settled = true;
        stop();
        trackEvent("mp_resume_failed", {});
      }
    });
  }

  function startSession(roomCode: string, applySettings: boolean, isResume = false) {
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
    if (isResume) watchResume(socket);
    setActiveRoomCode(roomCode);
    // The breadcrumb that lets Home offer "Return to Game" if the app is closed
    // or backgrounded away. Removed again by a deliberate Leave.
    rememberActiveRoom(roomCode);
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
    clearActiveRoom();
    session?.close();
    setSession(null);
    setActiveRoomCode(null);
    setMatchActive(false);
    setView("menu");
  }

  /**
   * Every way out of a live game goes through here.
   *
   * A room keeps playing without you, so walking out by accident - a stray back
   * press, a tap on the mode tabs - costs the round and the seat. The lobby and
   * the finished champion screen are not guarded: neither has anything to lose.
   */
  function leave(run: () => void) {
    if (matchActive) setPendingLeave({ run });
    else run();
  }

  function confirmLeave() {
    trackEvent("mp_leave_confirmed", {});
    const action = pendingLeave?.run;
    setPendingLeave(null);
    action?.();
  }

  function cancelLeave() {
    trackEvent("mp_leave_cancelled", {});
    setPendingLeave(null);
  }

  // The hardware back button is handled centrally, so a live game has to
  // register its objection rather than pass a prop.
  useEffect(() => {
    if (!matchActive) return;
    return registerNavigationGuard(() => {
      setPendingLeave({ run: exitRoom });
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchActive, activeRoomCode, session]);

  if (session) {
    return (
      <div className="screen">
        <AppHeader
          title="Play Together"
          onBack={() => leave(exitRoom)}
          onNavigateToHome={() => leave(goHome)}
          onNavigateToSettings={() => leave(() => onNavigate(toSettings()))}
          onNavigateToShapeChallenge={() => leave(() => onNavigate(toShapeChallenge()))}
        />
        <SocialPointsBadge />
        <PlayTogetherRoom transport={session} onExit={exitRoom} onActiveChange={handleActiveChange} />
        {pendingLeave && <LeaveConfirmation onStay={cancelLeave} onLeave={confirmLeave} />}
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

      <SocialPointsBadge />

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

type LeaveConfirmationProps = {
  onStay: () => void;
  onLeave: () => void;
};

/** Escape and the backdrop both mean Stay: the safe answer is the one you reach by accident. */
function LeaveConfirmation({ onStay, onLeave }: LeaveConfirmationProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, { onClose: onStay });
  return (
    <div className="onboarding-overlay" role="presentation" onClick={onStay}>
      <div
        ref={dialogRef}
        className="password-prompt-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-leave-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="mp-leave-title">Leave game?</h2>
        <p className="status-text">You have an active multiplayer game. Are you sure you want to leave?</p>
        <div className="button-row">
          <Button onClick={onStay}>Stay in Game</Button>
          <Button variant="secondary" onClick={onLeave}>
            Leave Game
          </Button>
        </div>
      </div>
    </div>
  );
}
