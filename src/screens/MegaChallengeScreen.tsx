import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DoubleCoinsOffer from "../components/DoubleCoinsOffer";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import PenSkinMenu from "../components/PenSkinMenu";
import ScoreCard from "../components/ScoreCard";
import ResultComparison from "../components/ResultComparison";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  CHAMPION_SHARE_TEXT,
  CHAMPION_TITLE,
  MEGA_PERFECT_SCORE,
  MEGA_RARITY_LABELS,
  MEGA_SPECIFIC_UNLOCK_COST,
  PREVIEW_DURATION_MS,
  passScoreForDifficulty,
  penInkGlyphColor,
  randomCelebrationMessage,
  randomEncouragementMessage,
  type PenColorId,
  type PenSkinId,
} from "../app/constants";
import { ACHIEVEMENTS } from "../app/achievements";
import { MEGA_ALBUM_SIZE, MEGA_CARDS, type MegaCardDefinition } from "../engine/megaShapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playEncourageSound, playSelectSound, playSuccessSound, primeAudioContext } from "../engine/soundEngine";
import { addCoins, getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { getDifficulty } from "../services/difficultySettings";
import {
  collectedMegaCardCount,
  getMegaProgress,
  isMegaAlbumComplete,
  isMegaCardUnlocked,
  markChampionCelebrated,
  recordMegaResult,
  shouldCelebrateChampion,
  syncAchievementCardUnlocks,
  unlockMegaCard,
  type MegaChallengeProgress,
} from "../services/megaChallengeStore";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { getSelectedSkin, setSelectedSkin } from "../services/penSkinStore";
import { shareOrCopy } from "../services/nativeShare";
import { trackEvent } from "../services/analytics";
import { toAchievements, toHome, toInstructions, toMegaChallenge, toSettings, toShapeChallenge, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type MegaChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

function achievementNameFor(card: MegaCardDefinition): string {
  const achievement = ACHIEVEMENTS.find((a) => a.id === card.unlockAchievementId);
  return achievement ? `${achievement.icon} ${achievement.name} — ${achievement.description}` : "a secret achievement";
}

export default function MegaChallengeScreen({ onNavigate }: MegaChallengeScreenProps) {
  const [progress, setProgress] = useState<MegaChallengeProgress>(() => getMegaProgress());
  const [playingCard, setPlayingCard] = useState<MegaCardDefinition | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showChampionOverlay, setShowChampionOverlay] = useState(false);
  const [coins, setCoins] = useState(() => getCoins());

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  // Auto-unlock any cards whose linked achievement was earned since the last
  // visit. Plain statement in a mount effect (not a state initializer) - see
  // the StrictMode note in ShapeChallengeScreen for why side effects and
  // updaters must never mix.
  useEffect(() => {
    const newlyUnlocked = syncAchievementCardUnlocks();
    setProgress(getMegaProgress());
    if (newlyUnlocked.length > 0) {
      setBanner(
        newlyUnlocked.length === 1
          ? `🃏 New Mega Card unlocked: ${newlyUnlocked[0].name}!`
          : `🃏 ${newlyUnlocked.length} new Mega Cards unlocked!`,
      );
    }
    if (shouldCelebrateChampion()) setShowChampionOverlay(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timeoutId = window.setTimeout(() => setBanner(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [banner]);

  function refreshProgress() {
    setProgress(getMegaProgress());
    if (shouldCelebrateChampion()) setShowChampionOverlay(true);
  }

  function handleBuyCard(card: MegaCardDefinition) {
    const cost = MEGA_SPECIFIC_UNLOCK_COST[card.rarity];
    if (coins < cost || progress.unlockedCardIds.includes(card.id)) return;
    spendCoins(cost);
    unlockMegaCard(card.id);
    playSuccessSound();
    setBanner(`🃏 New Mega Card unlocked: ${card.name}!`);
    refreshProgress();
  }

  function handleDismissChampionOverlay() {
    markChampionCelebrated();
    setShowChampionOverlay(false);
    refreshProgress();
  }

  async function handleShareChampion() {
    await shareOrCopy({
      title: CHAMPION_TITLE,
      text: CHAMPION_SHARE_TEXT,
      url: location.origin,
    });
  }

  const goToAchievements = () => onNavigate(toAchievements(toMegaChallenge()));
  const goToInstructions = () => onNavigate(toInstructions(toMegaChallenge()));
  const goToShop = (highlightPenColorId?: PenColorId) => onNavigate(toShop(toMegaChallenge(), highlightPenColorId));
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  if (playingCard) {
    return (
      <MegaPlay
        card={playingCard}
        onFinished={() => {
          setPlayingCard(null);
          refreshProgress();
        }}
        onNavigate={onNavigate}
      />
    );
  }

  // Display count and per-card unlock honor the Settings "unlock everything"
  // test toggle; the Champion status stays strictly on real progress so the
  // permanent title can never be faked by (or persisted from) the toggle.
  const collected = collectedMegaCardCount();
  const percent = Math.round((collected / MEGA_ALBUM_SIZE) * 100);
  const isChampion = isMegaAlbumComplete();

  return (
    <div className="screen">
      <AppHeader
        title="Mega Challenge"
        onBack={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={goToHome}
        onNavigateToAchievements={goToAchievements}
        onNavigateToInstructions={goToInstructions}
        onNavigateToShop={goToShop}
        onNavigateToShapeChallenge={goToShapeChallenge}
        onNavigateToSettings={goToSettings}
      />

      {banner && <div className="celebration-banner">{banner}</div>}

      <div className="mega-album-content">
        <div className="mega-hero">
          <div className="mega-hero-top">
            <span className="mega-hero-icon" aria-hidden="true">
              {isChampion ? "👑" : "🃏"}
            </span>
            <div className="mega-hero-titles">
              <h2>Mega Challenge Album</h2>
              <p>{isChampion ? CHAMPION_TITLE : "Complete your legendary album"}</p>
            </div>
          </div>
          <div className="mega-hero-progress-line">
            <span>
              Progress: {collected} / {MEGA_ALBUM_SIZE} collected
            </span>
            <span>{percent}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill mega-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="mega-hero-hint">Unlock cards with coins or earn them through achievements.</p>
        </div>

        <div className="mega-album-grid">
          {MEGA_CARDS.map((card) => {
            const unlocked = isMegaCardUnlocked(card.id);
            const bestScore = progress.bestScores[card.id];
            const isPerfect = progress.perfectCardIds.includes(card.id);
            const cost = MEGA_SPECIFIC_UNLOCK_COST[card.rarity];
            return unlocked ? (
              <button
                key={card.id}
                type="button"
                className={`mega-card mega-card-open mega-card-${card.rarity}`}
                onClick={() => {
                  playSelectSound();
                  setPlayingCard(card);
                }}
                aria-label={`Play ${card.name}`}
              >
                <span className={`mega-rarity-badge mega-rarity-${card.rarity}`}>{MEGA_RARITY_LABELS[card.rarity]}</span>
                <span className="mega-card-collected" aria-hidden="true">
                  ✓
                </span>
                <span className="mega-card-art">
                  <ShapePreviewIcon shape={card} size={88} />
                </span>
                <span className="mega-card-name">
                  {card.icon} {card.name}
                </span>
                <span className="mega-card-footer">
                  {isPerfect ? (
                    <span className="mega-card-state">✨ Perfect</span>
                  ) : bestScore !== undefined ? (
                    <span className="mega-card-cta mega-card-cta-replay">Best score: {bestScore}%</span>
                  ) : (
                    <span className="mega-card-cta">Start Challenge</span>
                  )}
                </span>
              </button>
            ) : (
              <div
                key={card.id}
                className={`mega-card mega-card-locked mega-card-${card.rarity}`}
                title={achievementNameFor(card)}
              >
                <span className={`mega-rarity-badge mega-rarity-${card.rarity}`}>{MEGA_RARITY_LABELS[card.rarity]}</span>
                <span className="mega-card-art mega-card-back" aria-hidden="true">
                  <span className="mega-card-qmark">?</span>
                  <span className="mega-card-lock">🔒</span>
                </span>
                <span className="mega-card-name mega-card-name-locked">Mystery Card</span>
                <Button
                  variant="secondary"
                  className="mega-card-unlock-btn"
                  disabled={coins < cost}
                  onClick={() => handleBuyCard(card)}
                >
                  Unlock — {cost.toLocaleString("en-US")} 🪙
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {isChampion && (
        <div className="card mega-champion-card">
          <p className="mega-champion-title">👑 {CHAMPION_TITLE}</p>
          <p className="status-text">You completed the full Mega Album. Your title and crown are permanent!</p>
          <Button variant="secondary" onClick={handleShareChampion}>
            <span aria-hidden="true">🔗</span> Share Your Achievement
          </Button>
        </div>
      )}

      {showChampionOverlay && (
        <div className="mega-champion-overlay" role="dialog" aria-label={CHAMPION_TITLE}>
          <div className="mega-champion-dialog">
            <span className="mega-champion-crown" aria-hidden="true">
              👑
            </span>
            <h2>{CHAMPION_TITLE}</h2>
            <p>
              You collected all {MEGA_ALBUM_SIZE} Mega drawings and completed the album! This permanent title and the
              crown badge next to your coins are now yours, forever.
            </p>
            <Button onClick={handleShareChampion}>
              <span aria-hidden="true">🔗</span> Share Your Achievement
            </Button>
            <Button variant="secondary" onClick={handleDismissChampionOverlay}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- play flow (mirrors SpecialChallengeScreen's phases) ----------

type MegaPhase = "preview" | "drawing" | "analyzing" | "result";

type MegaPlayProps = {
  card: MegaCardDefinition;
  onFinished: () => void;
  onNavigate: (screen: Screen) => void;
};

function MegaPlay({ card, onFinished, onNavigate }: MegaPlayProps) {
  const [phase, setPhase] = useState<MegaPhase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [doubleOfferAmount, setDoubleOfferAmount] = useState<number | null>(null);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const [penSkin, setPenSkin] = useState<PenSkinId>(() => getSelectedSkin());
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  const target = useMemo(() => card.generate(CANVAS_SIZE), [card]);
  const passScore = passScoreForDifficulty(getDifficulty());
  const showTargetGhost = phase === "preview";

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => {
      trackEvent("game_started", { gameType: "megaChallenge", category: card.category, contentKey: card.id });
      setPhase("drawing");
    }, PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase, card]);

  function handleSelectPenSkin(id: PenSkinId) {
    setSelectedSkin(id);
    setPenSkin(id);
  }

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleDone() {
    if (!attemptPath) return;
    primeAudioContext();
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(target, attemptPath);
      const passed = scoreResult.total >= passScore;
      const outcome = recordMegaResult(card.id, scoreResult.total, passed);
      if (outcome.completionRewardCoins > 0) {
        addCoins(outcome.completionRewardCoins);
        setDoubleOfferAmount(outcome.completionRewardCoins);
      }

      setResult(scoreResult);
      setFeedbackMessage(
        scoreResult.total >= MEGA_PERFECT_SCORE
          ? "✨ Perfect Score!"
          : passed
            ? randomCelebrationMessage()
            : randomEncouragementMessage(),
      );
      if (passed) playSuccessSound();
      else playEncourageSound();
      trackEvent("game_completed", { gameType: "megaChallenge", category: card.category, contentKey: card.id });
      setPhase("result");
    }, delay);
  }

  /** Only the extra half of a successful double is new - the base reward was credited immediately, so leaving mid-offer never forfeits earned coins (same rule as SpecialChallengeScreen). */
  function handleDoubleOfferResolved(finalAmount: number, anchorEl: HTMLElement | null) {
    if (doubleOfferAmount !== null && finalAmount > doubleOfferAmount) {
      addCoins(finalAmount - doubleOfferAmount);
    }
    triggerCoinFlight(anchorEl);
    setDoubleOfferAmount(null);
  }

  function handleRetry() {
    setAttemptPath(null);
    setResult(null);
    setFeedbackMessage(null);
    setDoubleOfferAmount(null);
    setPhase("preview");
  }

  const goToAchievements = () => onNavigate(toAchievements(toMegaChallenge()));
  const goToInstructions = () => onNavigate(toInstructions(toMegaChallenge()));
  const goToShop = (highlightPenColorId?: PenColorId) => onNavigate(toShop(toMegaChallenge(), highlightPenColorId));
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  const header = (
    <AppHeader
      title={card.name}
      subtitle={`${MEGA_RARITY_LABELS[card.rarity]} Mega Card`}
      onBack={onFinished}
      onNavigateToHome={goToHome}
      onNavigateToAchievements={goToAchievements}
      onNavigateToInstructions={goToInstructions}
      onNavigateToShop={goToShop}
      onNavigateToShapeChallenge={goToShapeChallenge}
      onNavigateToSettings={goToSettings}
    />
  );

  if (phase === "result" && result && attemptPath) {
    const passed = result.total >= passScore;
    return (
      <div className="screen">
        {header}
        {feedbackMessage && (
          <div className={passed ? "celebration-banner" : "encourage-banner"}>
            {passed ? "🎉 " : "💪 "}
            {feedbackMessage}
          </div>
        )}
        <ScoreCard score={result} showPercentSign />
        {doubleOfferAmount !== null && (
          <DoubleCoinsOffer amount={doubleOfferAmount} onResolved={handleDoubleOfferResolved} placement="mega_challenge_bonus" />
        )}
        <ResultComparison target={target} attempt={attemptPath} attemptColor={penColor} />
        {doubleOfferAmount === null && (
          <div className="button-row">
            <Button variant="secondary" onClick={handleRetry}>
              Try Again
            </Button>
            <Button onClick={onFinished}>Back to Album</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
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
              onLockedSkinClick={(id) => onNavigate(toShop(toMegaChallenge(), undefined, id))}
            />
          </div>
          <div className="button-row">
            <Button
              variant="secondary"
              onClick={() => canvasRef.current?.undoLastStroke()}
              disabled={!attemptPath || attemptPath.points.length === 0}
            >
              Undo
            </Button>
            <Button onClick={handleDone}>Done</Button>
          </div>
        </>
      )}
    </div>
  );
}
