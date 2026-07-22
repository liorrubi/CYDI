import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DoubleCoinsOffer from "../components/DoubleCoinsOffer";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import PenSkinMenu from "../components/PenSkinMenu";
import ScoreCard from "../components/ScoreCard";
import ResultComparison from "../components/ResultComparison";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  PREVIEW_DURATION_MS,
  SPECIAL_CHALLENGE_COIN_BANDS,
  SPECIAL_CHALLENGE_MIN_SCORE,
  SPECIAL_CHALLENGE_RETRY_COST,
  coinsForSpecialChallengeScore,
  penInkGlyphColor,
  randomCelebrationMessage,
  randomEncouragementMessage,
  type PenColorId,
  type PenSkinId,
} from "../app/constants";
import { getShapeById, getShapesForCategory } from "../content/contentRepository";
import { scoreAttempt } from "../engine/scoring";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playEncourageSound, playSuccessSound, primeAudioContext } from "../engine/soundEngine";
import { addCoins, getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { getSelectedSkin, setSelectedSkin } from "../services/penSkinStore";
import { trackEvent } from "../services/analytics";
import {
  canPlaySpecialChallengeFree,
  getSpecialChallengeBestScore,
  markSpecialChallengeFreeUsed,
  msUntilNextLocalMidnight,
  pickDailyShapeId,
  recordSpecialChallengeScore,
} from "../services/specialChallengeStore";
import { toAchievements, toHome, toInstructions, toSettings, toShapeChallenge, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "intro" | "preview" | "drawing" | "analyzing" | "result";

type SpecialChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

/** Daily-rotating target - deterministically picked from the Fantasy category by calendar date, so every player sees the same "special" shape on a given day and it changes at local midnight. */
const SPECIAL_CHALLENGE_SHAPE_POOL = getShapesForCategory("fantasy").map((s) => s.id);
const SHAPE = getShapeById(pickDailyShapeId(SPECIAL_CHALLENGE_SHAPE_POOL))!;

/** Compact score-to-coins table for the intro card, listed low to high (SPECIAL_CHALLENGE_COIN_BANDS itself is ordered high to low for the lookup in coinsForSpecialChallengeScore). */
const REWARD_ROWS = [...SPECIAL_CHALLENGE_COIN_BANDS].reverse();

/** "New shape in HH:MM" ticking down to the next local midnight, refreshed every 30s (minute-granularity display doesn't need finer resolution). */
function useTimeUntilNextShape(): string {
  const [remainingMs, setRemainingMs] = useState(msUntilNextLocalMidnight);

  useEffect(() => {
    const intervalId = window.setInterval(() => setRemainingMs(msUntilNextLocalMidnight()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const totalMinutes = Math.max(0, Math.floor(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function SpecialChallengeScreen({ onNavigate }: SpecialChallengeScreenProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  // Whether the attempt currently in progress is the day's free one - only true once, for
  // whichever attempt happens to be the first completed today; every attempt after that
  // (including retries within this same visit) costs coins, checked at completion time.
  const isFreeAttemptRef = useRef(canPlaySpecialChallengeFree());
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [doubleOfferAmount, setDoubleOfferAmount] = useState<number | null>(null);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const [penSkin, setPenSkin] = useState<PenSkinId>(() => getSelectedSkin());
  const [coins, setCoins] = useState(() => getCoins());
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const timeUntilNextShape = useTimeUntilNextShape();

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  const target = useMemo(() => SHAPE.generate(CANVAS_SIZE), []);
  const showTargetGhost = phase === "preview";

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => {
      trackEvent("game_started", { gameType: "specialChallenge", category: SHAPE.category, contentKey: SHAPE.id });
      setPhase("drawing");
    }, PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

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

  function handleDone() {
    if (!attemptPath) return;
    primeAudioContext();
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(target, attemptPath);
      if (isFreeAttemptRef.current) {
        markSpecialChallengeFreeUsed();
        isFreeAttemptRef.current = false;
      }

      const passed = scoreResult.total >= SPECIAL_CHALLENGE_MIN_SCORE;
      // Pay out only the improvement over this shape's previous best score - not the
      // full tier reward every time - same economy as Shape Challenge's per-shape
      // best-score delta, so replaying at the same or a lower score earns nothing.
      const previousBest = getSpecialChallengeBestScore(SHAPE.id);
      const reward = coinsForSpecialChallengeScore(scoreResult.total) - coinsForSpecialChallengeScore(previousBest ?? 0);
      recordSpecialChallengeScore(SHAPE.id, scoreResult.total);
      if (reward > 0) {
        addCoins(reward);
        setDoubleOfferAmount(reward);
      }

      setResult(scoreResult);
      setFeedbackMessage(passed ? randomCelebrationMessage() : randomEncouragementMessage());
      if (passed) playSuccessSound();
      else playEncourageSound();
      trackEvent("game_completed", { gameType: "specialChallenge", category: SHAPE.category, contentKey: SHAPE.id });
      setPhase("result");
    }, delay);
  }

  /** The base reward is already credited above - only the extra half of a successful double is new (mirrors ChestRewardOverlay), so navigating away before resolving the offer can never forfeit the coins already earned. */
  function handleDoubleOfferResolved(finalAmount: number, anchorEl: HTMLElement | null) {
    if (doubleOfferAmount !== null && finalAmount > doubleOfferAmount) {
      addCoins(finalAmount - doubleOfferAmount);
    }
    triggerCoinFlight(anchorEl);
    setDoubleOfferAmount(null);
  }

  /** Starts a fresh attempt, charging the retry cost first - used both from the intro card and from the result screen, since by the time either is reachable the day's free attempt is already spent. */
  function handlePaidRetry() {
    if (coins < SPECIAL_CHALLENGE_RETRY_COST) return;
    spendCoins(SPECIAL_CHALLENGE_RETRY_COST);
    setAttemptPath(null);
    setResult(null);
    setFeedbackMessage(null);
    setDoubleOfferAmount(null);
    setPhase("preview");
  }

  const goToAchievements = () => onNavigate(toAchievements(toHome()));
  const goToInstructions = () => onNavigate(toInstructions(toHome()));
  const goToShop = (highlightPenColorId?: PenColorId) => onNavigate(toShop(toHome(), highlightPenColorId));
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  if (phase === "intro") {
    const freeAvailable = isFreeAttemptRef.current;
    return (
      <div className="screen">
        <AppHeader
          title="Special Challenge"
          onBack={goToHome}
          onNavigateToHome={goToHome}
          onNavigateToAchievements={goToAchievements}
          onNavigateToInstructions={goToInstructions}
          onNavigateToShop={goToShop}
          onNavigateToShapeChallenge={goToShapeChallenge}
          onNavigateToSettings={goToSettings}
        />
        <div className="card instructions-card">
          <h2>👑 Special Challenge</h2>
          <p className="status-text special-challenge-subtitle">Daily special shape — changes every day</p>
          <p className="status-text special-challenge-timer">⏱ New shape in {timeUntilNextShape}</p>
          <p className="status-text">
            Study the shape, then draw it as accurately as you can. Your score is based on how precise your
            drawing is, and a passing score earns you a coin reward.
          </p>
          <div className="instructions-star-list">
            {REWARD_ROWS.map((band) => (
              <div key={band.minScore} className="instructions-star-row">
                <span>Score {band.minScore}+</span>
                <span>🪙 {band.coins}</span>
              </div>
            ))}
          </div>
        </div>
        {freeAvailable ? (
          <Button onClick={() => setPhase("preview")}>Start Challenge</Button>
        ) : (
          <div className="card">
            <p className="status-text">You've already played today's Special Challenge for free. Come back tomorrow, or try again now.</p>
            <Button disabled={coins < SPECIAL_CHALLENGE_RETRY_COST} onClick={handlePaidRetry}>
              Try Again for 🪙 {SPECIAL_CHALLENGE_RETRY_COST}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "result" && result && attemptPath) {
    const passed = result.total >= SPECIAL_CHALLENGE_MIN_SCORE;
    return (
      <div className="screen">
        <AppHeader
          onBack={() => setPhase("intro")}
          onNavigateToHome={goToHome}
          onNavigateToAchievements={goToAchievements}
          onNavigateToInstructions={goToInstructions}
          onNavigateToShop={goToShop}
          onNavigateToShapeChallenge={goToShapeChallenge}
          onNavigateToSettings={goToSettings}
        />
        {feedbackMessage && (
          <div className={passed ? "celebration-banner" : "encourage-banner"}>
            {passed ? "🎉 " : "💪 "}
            {feedbackMessage}
          </div>
        )}
        <ScoreCard score={result} showPercentSign />
        {doubleOfferAmount !== null && <DoubleCoinsOffer amount={doubleOfferAmount} onResolved={handleDoubleOfferResolved} />}
        <ResultComparison target={target} attempt={attemptPath} attemptColor={penColor} />
        {doubleOfferAmount === null && (
          <Button variant="secondary" disabled={coins < SPECIAL_CHALLENGE_RETRY_COST} onClick={handlePaidRetry}>
            Try Again for 🪙 {SPECIAL_CHALLENGE_RETRY_COST}
          </Button>
        )}
        <p className="status-text special-challenge-timer">Come back tomorrow for a new shape.</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title="Special Challenge"
        onBack={goToHome}
        onNavigateToHome={goToHome}
        onNavigateToAchievements={goToAchievements}
        onNavigateToInstructions={goToInstructions}
        onNavigateToShop={goToShop}
        onNavigateToShapeChallenge={goToShapeChallenge}
        onNavigateToSettings={goToSettings}
      />
      <p className="status-text canvas-instruction-text">
        {phase === "preview" && "Study the shape"}
        {phase === "drawing" && "Now draw it as accurately as you can"}
        {phase === "analyzing" && "Analyzing..."}
      </p>
      <div className="canvas-wrapper">
        <DrawingCanvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          disabled={phase !== "drawing"}
          ghostPath={showTargetGhost ? target : undefined}
          showGhost={showTargetGhost}
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
              onLockedSkinClick={(id) => onNavigate(toShop(toHome(), undefined, id))}
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
    </div>
  );
}
