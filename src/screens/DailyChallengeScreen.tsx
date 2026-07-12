import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DailyLeaderboardTable from "../components/DailyLeaderboardTable";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import PenSkinMenu from "../components/PenSkinMenu";
import ScoreCard from "../components/ScoreCard";
import ShapeOverlayCanvas from "../components/ShapeOverlayCanvas";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  PREVIEW_DURATION_MS,
  penColorCssBackground,
  penInkGlyphColor,
  randomCelebrationMessage,
  randomEncouragementMessage,
  type PenColorId,
  type PenSkinId,
} from "../app/constants";
import { DAILY_CHALLENGE_PRIZE_COINS } from "../app/dailyChallengePrizes";
import { getShapeById } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import { playEncourageSound, playSuccessSound, primeAudioContext } from "../engine/soundEngine";
import { addCoins } from "../services/coinsStore";
import { dailyChallengeShareUrl } from "../services/dailyChallengeShare";
import { shareOrCopy } from "../services/nativeShare";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { getSelectedSkin, setSelectedSkin } from "../services/penSkinStore";
import { trackEvent } from "../services/analytics";
import {
  claimDailyPrizes,
  fetchCurrentDailyEpisode,
  fetchDailyEpisode,
  submitDailyScore,
  type DailyEpisode,
  type DailySubmitResult,
} from "../services/dailyChallengeApi";
import { ANONYMOUS_PLAYER_NAME, getDisplayName, getPlayerId, getPlayerName, setPlayerName } from "../services/playerProfileStore";
import {
  toAchievements,
  toDailyChallengeHistory,
  toHome,
  toInstructions,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "loading" | "error" | "preview" | "drawing" | "analyzing" | "result";

/** Shared wording for every coin-prize notification, so a queued 2nd-place claim and an instant 1st-place win read the same way. */
function formatDailyPrizeMessage(coins: number): string {
  return `🏆 You won ${coins} coins in the Daily Challenge!`;
}

export type DailyReplayTarget = { id: number };

type DailyChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
  /** When set, plays back an ended challenge instead of today's live one: no name field, no winner/coin logic, personal best only. */
  replay?: DailyReplayTarget;
};

export default function DailyChallengeScreen({ onNavigate, replay }: DailyChallengeScreenProps) {
  const playerId = useMemo(() => getPlayerId(), []);
  const [phase, setPhase] = useState<Phase>("loading");
  const [episode, setEpisode] = useState<DailyEpisode | null>(null);
  const [yourBest, setYourBest] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => getPlayerName());
  const [isEditingName, setIsEditingName] = useState(false);
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [submission, setSubmission] = useState<DailySubmitResult | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  /** One line per unclaimed prize (never summed) - a player who was away for several episodes could have more than one queued at once. */
  const [prizeMessages, setPrizeMessages] = useState<string[]>([]);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const [penSkin, setPenSkin] = useState<PenSkinId>(() => getSelectedSkin());
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  /** Hands over any queued 1st/2nd/3rd place prizes and credits their coins - safe to call any time, since the server clears each prize the moment it's handed over. */
  async function claimPrizes() {
    const result = await claimDailyPrizes(playerId);
    if (!result || result.claimed.length === 0) return [];
    addCoins(result.claimed.reduce((sum, prize) => sum + prize.coins, 0));
    return result.claimed;
  }

  async function load() {
    setPhase("loading");
    const fetched = replay ? await fetchDailyEpisode(replay.id, playerId) : await fetchCurrentDailyEpisode(playerId);
    if (!fetched) {
      setPhase("error");
      return;
    }
    setEpisode(fetched);
    setYourBest(fetched.yourBest);
    setIsNewBest(false);
    setSubmission(null);
    setAttemptPath(null);
    setResult(null);
    setFeedbackMessage(null);
    setPhase("preview");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay?.id]);

  // Catches prizes earned while the player wasn't actively submitting - e.g.
  // they placed 2nd/3rd earlier and someone else's win or the midnight
  // rollover ended the episode after they'd already moved on. The instant-win
  // case (this player's own submission just won) is claimed separately in
  // handleDone, right when it happens.
  useEffect(() => {
    if (replay) return;
    claimPrizes().then((claimed) => {
      if (claimed.length === 0) return;
      setPrizeMessages((prev) => [...prev, ...claimed.map((prize) => formatDailyPrizeMessage(prize.coins))]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shape = episode ? getShapeById(episode.shapeId) : undefined;

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => {
      if (episode && shape) {
        trackEvent("game_started", { gameType: "dailyChallenge", category: shape.category, contentKey: `daily:${episode.id}` });
      }
      setPhase("drawing");
    }, PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase, episode, shape]);
  const target = useMemo(() => shape?.generate(CANVAS_SIZE), [shape]);

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleSelectPenSkin(id: PenSkinId) {
    setSelectedSkin(id);
    setPenSkin(id);
  }

  function handleUndo() {
    canvasRef.current?.undoLastStroke();
  }

  function handleNameChange(value: string) {
    setNameDraft(value);
    setPlayerName(value);
  }

  async function handleShare() {
    const url = dailyChallengeShareUrl();
    const outcome = await shareOrCopy({
      title: "CYDI Daily Challenge",
      text: "Can you beat today's CYDI Daily Challenge? Draw it from memory - no peeking!",
      url,
    });
    if ((outcome === "shared" || outcome === "copied") && episode && shape) {
      trackEvent("result_shared", { gameType: "dailyChallenge", category: shape.category, contentKey: `daily:${episode.id}` });
    }
    if (outcome === "copied") {
      setShareFeedback("Link copied!");
      window.setTimeout(() => setShareFeedback(null), 2500);
    } else if (outcome === "failed") {
      setShareFeedback(`Couldn't share automatically - copy this link: ${url}`);
    }
  }

  function handleDone() {
    if (!attemptPath || !target || !episode || !shape) return;
    const previousBest = yourBest;
    primeAudioContext();
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(async () => {
      const scoreResult = scoreAttempt(target, attemptPath);
      setResult(scoreResult);

      const playerName = replay ? ANONYMOUS_PLAYER_NAME : getDisplayName();
      const response = await submitDailyScore({ playerId, playerName, episodeId: episode.id, score: scoreResult.total });

      const newBest = response ? response.yourBest : Math.max(previousBest ?? 0, scoreResult.total);
      setYourBest(newBest);
      setIsNewBest(previousBest === null || newBest > previousBest);
      if (response) {
        setSubmission(response);
        // The "you won" banner below already announces this - the prize itself
        // (queued server-side the instant the episode ended) just needs claiming.
        if (response.youWon) await claimPrizes();
      }

      const passed = scoreResult.total >= 70;
      setFeedbackMessage(passed ? randomCelebrationMessage() : randomEncouragementMessage());
      if (passed) playSuccessSound();
      else playEncourageSound();
      trackEvent("game_completed", { gameType: "dailyChallenge", category: shape.category, contentKey: `daily:${episode.id}` });
      setPhase("result");
    }, delay);
  }

  function handleTryAgain() {
    setAttemptPath(null);
    setResult(null);
    setSubmission(null);
    setFeedbackMessage(null);
    setPhase("preview");
  }

  const goToAchievements = () => onNavigate(toAchievements(toHome()));
  const goToInstructions = () => onNavigate(toInstructions(toHome()));
  const goToShop = (highlightPenColorId?: PenColorId) => onNavigate(toShop(toHome(), highlightPenColorId));
  const goToSpecialChallenge = () => onNavigate(toSpecialChallenge());
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());
  const goBack = replay ? () => onNavigate(toDailyChallengeHistory()) : goToHome;

  if (phase === "loading") {
    return (
      <div className="screen">
        <AppHeader
          title="Daily Challenge"
          onBack={goBack}
          onNavigateToHome={goToHome}
          onNavigateToSettings={goToSettings}
          onNavigateToShapeChallenge={goToShapeChallenge}
        />
        <p className="status-text">Loading today's challenge...</p>
      </div>
    );
  }

  if (phase === "error" || !episode || !shape || !target) {
    return (
      <div className="screen">
        <AppHeader
          title="Daily Challenge"
          onBack={goBack}
          onNavigateToHome={goToHome}
          onNavigateToSettings={goToSettings}
          onNavigateToShapeChallenge={goToShapeChallenge}
        />
        <p className="form-error">Couldn't reach the daily challenge. Check your connection and try again.</p>
        <Button onClick={load}>Retry</Button>
      </div>
    );
  }

  const isLive = !replay;
  // The "winner" of an episode is always its #1 leaderboard entry - live, that's
  // just today's current leader; for a replay it's frozen at whatever it was
  // when the episode ended, since topEntries never changes after that.
  const leader = episode.topEntries[0] ?? null;
  const newChallengeAvailable = isLive && submission !== null && submission.current.id !== episode.id;

  if (phase === "result" && result && attemptPath) {
    return (
      <div className="screen">
        <AppHeader
          onNavigateToHome={goToHome}
          onNavigateToInstructions={goToInstructions}
          onNavigateToAchievements={goToAchievements}
          onNavigateToShop={goToShop}
          onNavigateToSpecialChallenge={goToSpecialChallenge}
          onNavigateToShapeChallenge={goToShapeChallenge}
          onNavigateToSettings={goToSettings}
        />
        {submission?.youWon && (
          <div className="celebration-banner">🏆 You reached 100 first - you won {DAILY_CHALLENGE_PRIZE_COINS[0]} coins!</div>
        )}
        {!submission?.youWon && newChallengeAvailable && <div className="encourage-banner">A new day's challenge has started.</div>}
        {!submission?.youWon && feedbackMessage && <div className="encourage-banner">💪 {feedbackMessage}</div>}
        <ScoreCard score={result} isNewBest={isNewBest} showPercentSign />
        {yourBest !== null && (
          <p className="best-summary">
            Your best for this shape: <strong>{yourBest}%</strong>
          </p>
        )}
        <div className="canvas-wrapper">
          <ShapeOverlayCanvas target={target} attempt={attemptPath} attemptColor={penColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
        </div>
        <p className="overlay-legend">
          <span className="overlay-legend-swatch overlay-legend-target" /> Target shape
          <span
            className="overlay-legend-swatch"
            style={{ background: penColorCssBackground(penColor), marginLeft: "var(--space-3)" }}
          />{" "}
          Your drawing
        </p>
        <div className="button-row">
          <Button variant="secondary" onClick={handleTryAgain}>
            Try Again
          </Button>
          {newChallengeAvailable && <Button onClick={load}>Play New Challenge</Button>}
        </div>
        {replay && (
          <Button variant="secondary" onClick={() => onNavigate(toDailyChallengeHistory())}>
            Back to Previous Challenges
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title={replay ? `Challenge from ${episode.dateKey}` : "Daily Challenge"}
        subtitle={!isLive ? (leader ? `Winner: ${leader.playerName} (${leader.score}%)` : "No winner - challenge expired") : undefined}
        onBack={goBack}
        onNavigateToAchievements={goToAchievements}
        onNavigateToInstructions={goToInstructions}
        onNavigateToShop={goToShop}
        onNavigateToSpecialChallenge={goToSpecialChallenge}
        onNavigateToShapeChallenge={goToShapeChallenge}
        onNavigateToHome={goToHome}
        onNavigateToSettings={goToSettings}
      />
      <div className="daily-status-line">
        <span>Your best: {yourBest === null ? "—" : `${yourBest}%`}</span>
        {isLive && (
          <>
            <span className="daily-status-dot" aria-hidden="true">
              •
            </span>
            <span>{leader ? `Top score: ${leader.score}% by ${leader.playerName}` : "Be the first to set a score today!"}</span>
          </>
        )}
      </div>
      {isLive && (
        <div className="daily-name-row">
          {isEditingName ? (
            <input
              autoFocus
              className="daily-name-input"
              placeholder="Your name (optional)"
              value={nameDraft}
              maxLength={24}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditingName(false)}
            />
          ) : (
            <button
              type="button"
              className="daily-name-display"
              onClick={() => setIsEditingName(true)}
              aria-label={`Edit display name, currently ${nameDraft.trim() || ANONYMOUS_PLAYER_NAME}`}
            >
              Playing as: <strong>{nameDraft.trim() || ANONYMOUS_PLAYER_NAME}</strong> <span aria-hidden="true">✏️</span>
            </button>
          )}
        </div>
      )}
      {isLive && prizeMessages.length > 0 && (
        <div className="celebration-banner prize-banner">
          <div className="prize-banner-messages">
            {prizeMessages.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </div>
          <button type="button" className="prize-banner-dismiss" onClick={() => setPrizeMessages([])} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <p className="status-text canvas-instruction-text">
        {phase === "preview" && "Study the shape - you'll draw it from memory"}
        {phase === "drawing" && "Now draw it from memory"}
        {phase === "analyzing" && "Analyzing..."}
      </p>
      <div className="canvas-wrapper">
        <DrawingCanvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          disabled={phase !== "drawing"}
          ghostPath={phase === "preview" ? target : undefined}
          showGhost={phase === "preview"}
          strokeColor={penColor}
          penSkin={penSkin}
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <>
          <div className="pen-tools-row">
            <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={goToShop} />
            <PenSkinMenu
              selected={penSkin}
              inkColor={penInkGlyphColor(penColor)}
              onSelect={handleSelectPenSkin}
              onLockedSkinClick={() => goToShop()}
            />
          </div>
          <div className="button-row">
            <Button variant="secondary" onClick={handleUndo} disabled={!attemptPath || attemptPath.points.length === 0}>
              Undo
            </Button>
            <Button onClick={handleDone}>Done</Button>
          </div>
        </>
      )}
      {isLive && (
        <div className="daily-secondary-actions">
          <Button variant="secondary" className="btn-compact" onClick={handleShare}>
            Share
          </Button>
          <Button variant="secondary" className="btn-compact" onClick={() => onNavigate(toDailyChallengeHistory())}>
            Previous Challenges
          </Button>
        </div>
      )}
      {isLive && shareFeedback && <p className="status-text">{shareFeedback}</p>}
      <DailyLeaderboardTable entries={episode.topEntries} highlightPlayerId={playerId} />
    </div>
  );
}
