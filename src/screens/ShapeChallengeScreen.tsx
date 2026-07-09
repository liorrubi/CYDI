import { useEffect, useMemo, useRef, useState } from "react";
import AchievementUnlockedBanner from "../components/AchievementUnlockedBanner";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DoubleCoinsOffer from "../components/DoubleCoinsOffer";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import ScoreCard from "../components/ScoreCard";
import ShapeOverlayCanvas from "../components/ShapeOverlayCanvas";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import StarRating from "../components/StarRating";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  CATEGORY_UNLOCK_COST,
  PREVIEW_DURATION_MS,
  coinsForStars,
  journeyRankForPercent,
  passScoreForDifficulty,
  penColorCssBackground,
  randomCelebrationMessage,
  randomEncouragementMessage,
  starRatingForScore,
  type PenColorId,
} from "../app/constants";
import { computeAchievementStats, findNewlyUnlockedAchievements, type Achievement } from "../app/achievements";
import { CATEGORIES, SHAPE_LIBRARY, shapesForCategory, type CategoryId } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import {
  playAchievementUnlockedSound,
  playEncourageSound,
  playSelectSound,
  playSuccessSound,
  primeAudioContext,
} from "../engine/soundEngine";
import { triggerCoinFlight } from "../engine/coinFlight";
import { getUnlockedAchievementIds, markAchievementUnlocked } from "../services/achievementsStore";
import { addCoins, addCoinsPending, getCoins, onCoinsChanged, revealPendingCoins, spendCoins } from "../services/coinsStore";
import { getUnlockedCategoryIds, unlockCategory } from "../services/categoryUnlockStore";
import { getDifficulty } from "../services/difficultySettings";
import { isUnlockEverythingActive } from "../services/unlockOverrideStore";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { recordRoundCompleted, shouldShowAchievementsTutorial } from "../services/tutorialStore";
import { recordSuccessfulDrawing } from "../services/successfulDrawingsStore";
import {
  clearProgress,
  getCategoryLevelIndex,
  getProgress,
  saveProgress,
  type ShapeChallengeProgress,
} from "../services/shapeChallengeProgress";
import { toAchievements, toHome, toInstructions, toSettings, toShapeChallenge, toShop, toSpecialChallenge } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "preview" | "drawing" | "analyzing" | "result";

type ShapeChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

/** Marks newly-unlocked achievements as unlocked and safely credits their coins to the real balance right away - the achievement queue passed back just controls when the celebratory banner/sound/counter-reveal happens, never whether the reward is actually paid out. */
function detectAndBankNewAchievements(progress: ShapeChallengeProgress): Achievement[] {
  const stats = computeAchievementStats(progress);
  const unlockedIds = getUnlockedAchievementIds();
  const newlyUnlocked = findNewlyUnlockedAchievements(stats, unlockedIds);
  for (const achievement of newlyUnlocked) {
    markAchievementUnlocked(achievement.id);
    addCoinsPending(achievement.coinReward);
  }
  return newlyUnlocked;
}

export default function ShapeChallengeScreen({ onNavigate }: ShapeChallengeScreenProps) {
  const [progress, setProgress] = useState<ShapeChallengeProgress>(() => getProgress());
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [justUnlockedIndex, setJustUnlockedIndex] = useState<number | null>(null);
  const [pendingAchievements, setPendingAchievements] = useState<Achievement[]>([]);

  // Retroactively award any achievements already satisfied by existing progress.
  // `detectAndBankNewAchievements` has real side effects (marks achievements
  // unlocked in localStorage, credits coins), so it must be called exactly
  // once as a plain statement here - React's StrictMode deliberately
  // double-invokes useState updater functions in dev to catch impure ones,
  // and calling a side-effecting function *inside* the updater used to mean
  // the first (throwaway) invocation would mark the achievements unlocked,
  // then the second (real) invocation would find them already unlocked and
  // compute zero newly-unlocked achievements - so the coins/localStorage
  // side effect landed correctly but the celebratory banner never appeared.
  useEffect(() => {
    let newlyUnlocked = detectAndBankNewAchievements(progress);
    // Same "let the tutorial cover it" rule as handleProgressChange, for a
    // returning player whose first round already qualifies at app boot.
    if (shouldShowAchievementsTutorial()) {
      newlyUnlocked = newlyUnlocked.filter((achievement) => achievement.id !== "first-steps");
    }
    setPendingAchievements((prev) => [...prev, ...newlyUnlocked]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play the fanfare each time a new achievement banner takes over the front of the queue.
  useEffect(() => {
    if (pendingAchievements.length > 0) playAchievementUnlockedSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAchievements[0]?.id]);

  function handleProgressChange(category: CategoryId, updated: ShapeChallengeProgress) {
    if (updated.levelIndexByCategory[category] > (progress.levelIndexByCategory[category] ?? 0)) {
      setJustUnlockedIndex(updated.levelIndexByCategory[category]);
    }
    setProgress(updated);
    let newlyUnlocked = detectAndBankNewAchievements(updated);
    // The very first achievement ("First Steps") lands on the same round that
    // triggers the achievements tutorial coach-mark - showing the normal
    // celebratory banner and the tutorial back-to-back would be redundant, so
    // this one case defers to the tutorial instead. Its coins are still
    // banked above regardless; only the banner is skipped.
    if (shouldShowAchievementsTutorial()) {
      newlyUnlocked = newlyUnlocked.filter((achievement) => achievement.id !== "first-steps");
    }
    setPendingAchievements((prev) => [...prev, ...newlyUnlocked]);
  }

  function handleCollectAchievement(bannerEl: HTMLElement | null) {
    triggerCoinFlight(bannerEl);
    revealPendingCoins();
  }

  function handleAchievementBannerDismissed() {
    setPendingAchievements((prev) => prev.slice(1));
  }

  function handleResetProgress() {
    setProgress(clearProgress());
    setJustUnlockedIndex(null);
  }

  const goToAchievements = () => onNavigate(toAchievements(toShapeChallenge()));
  const goToInstructions = () => onNavigate(toInstructions(toShapeChallenge()));
  const goToShop = () => onNavigate(toShop(toShapeChallenge()));
  const goToSpecialChallenge = () => onNavigate(toSpecialChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  const achievementBanner = pendingAchievements[0] && (
    <AchievementUnlockedBanner
      achievement={pendingAchievements[0]}
      onCollect={handleCollectAchievement}
      onDismissed={handleAchievementBannerDismissed}
    />
  );

  if (selectedCategory === null) {
    return (
      <>
        {achievementBanner}
        <CategoryListScreen
          progress={progress}
          onSelectCategory={setSelectedCategory}
          onBack={() => onNavigate(toHome())}
          onResetProgress={handleResetProgress}
          onNavigateToAchievements={goToAchievements}
          onNavigateToInstructions={goToInstructions}
          onNavigateToShop={goToShop}
          onNavigateToSpecialChallenge={goToSpecialChallenge}
          onNavigateToHome={goToHome}
          onNavigateToSettings={goToSettings}
        />
      </>
    );
  }

  if (selectedIndex === null) {
    return (
      <>
        {achievementBanner}
        <ShapeMap
          category={selectedCategory}
          progress={progress}
          onSelect={setSelectedIndex}
          onBack={() => setSelectedCategory(null)}
          justUnlockedIndex={justUnlockedIndex}
          onUnlockAnimationDone={() => setJustUnlockedIndex(null)}
          onNavigateToAchievements={goToAchievements}
          onNavigateToInstructions={goToInstructions}
          onNavigateToShop={goToShop}
          onNavigateToSpecialChallenge={goToSpecialChallenge}
          onNavigateToHome={goToHome}
          onNavigateToSettings={goToSettings}
        />
      </>
    );
  }

  return (
    <>
      {achievementBanner}
      <ShapePlay
        key={`${selectedCategory}-${selectedIndex}`}
        category={selectedCategory}
        levelIndex={selectedIndex}
        progress={progress}
        onProgressChange={(updated) => handleProgressChange(selectedCategory, updated)}
        onNextShape={setSelectedIndex}
        onBackToMap={() => setSelectedIndex(null)}
        onNavigateToAchievements={goToAchievements}
        onNavigateToInstructions={goToInstructions}
        onNavigateToShop={() => onNavigate(toShop(toShapeChallenge()))}
        onNavigateToSpecialChallenge={goToSpecialChallenge}
        onNavigateToHome={goToHome}
        onNavigateToSettings={goToSettings}
      />
    </>
  );
}

type CategoryListScreenProps = {
  progress: ShapeChallengeProgress;
  onSelectCategory: (category: CategoryId) => void;
  onBack: () => void;
  onResetProgress: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToInstructions: () => void;
  onNavigateToShop: () => void;
  onNavigateToSpecialChallenge: () => void;
  onNavigateToHome: () => void;
  onNavigateToSettings: () => void;
};

function CategoryListScreen({
  progress,
  onSelectCategory,
  onBack,
  onResetProgress,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: CategoryListScreenProps) {
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState(() => getUnlockedCategoryIds());
  const [coins, setCoins] = useState(() => getCoins());
  // The category mid-way through its short lock-opening animation - payment
  // and persistence already happened, this only delays the *visual* reveal
  // (progress bar etc.) so the player sees the lock pop open first.
  const [unlockingCategory, setUnlockingCategory] = useState<CategoryId | null>(null);
  const [showUnlockBanner, setShowUnlockBanner] = useState(false);

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  function handleConfirmReset() {
    onResetProgress();
    setResetStep(0);
  }

  // A category with progress already made under the old (pre-paywall) rules
  // stays accessible - the gate only applies to categories the player hasn't
  // touched yet, so this change can never retroactively lock out shapes
  // someone already unlocked by playing.
  function isCategoryAccessible(category: CategoryId): boolean {
    return unlockedCategoryIds.includes(category) || getCategoryLevelIndex(progress, category) > 0;
  }

  function handleUnlockCategory(category: CategoryId) {
    if (coins < CATEGORY_UNLOCK_COST) return;
    spendCoins(CATEGORY_UNLOCK_COST);
    unlockCategory(category);
    setUnlockingCategory(category);
    window.setTimeout(() => {
      setUnlockingCategory(null);
      setUnlockedCategoryIds(getUnlockedCategoryIds());
      setShowUnlockBanner(true);
      window.setTimeout(() => setShowUnlockBanner(false), 2000);
    }, 700);
  }

  const totalUnlocked = Object.values(progress.levelIndexByCategory).reduce((sum, n) => sum + n, 0);
  const totalShapes = SHAPE_LIBRARY.length;
  const overallPercent = Math.round((totalUnlocked / totalShapes) * 100);
  const rank = journeyRankForPercent(overallPercent);

  return (
    <div className="screen">
      <AppHeader
        title="Shape Challenge"
        onBack={onBack}
        onNavigateToAchievements={onNavigateToAchievements}
        onNavigateToInstructions={onNavigateToInstructions}
        onNavigateToShop={onNavigateToShop}
        onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSettings={onNavigateToSettings}
      />
      <div className="journey-progress">
        <p className="journey-rank">{rank}</p>
        <div className="journey-stats">
          <span>
            {totalUnlocked} of {totalShapes} shapes unlocked
          </span>
          <span>{overallPercent}%</span>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${overallPercent}%` }} />
        </div>
      </div>

      {showUnlockBanner && <div className="celebration-banner">🔓 New Category Unlocked!</div>}

      <div className="category-grid">
        {CATEGORIES.map((category, index) => {
          const shapes = shapesForCategory(category.id);
          const unlocked = Math.min(getCategoryLevelIndex(progress, category.id), shapes.length);
          const percent = Math.round((unlocked / shapes.length) * 100);
          const hue = Math.round((index / CATEGORIES.length) * 360);
          const accessible = isCategoryAccessible(category.id);
          const isUnlocking = unlockingCategory === category.id;
          const showAsLocked = !accessible && !isUnlocking;
          const canAffordUnlock = coins >= CATEGORY_UNLOCK_COST;
          return (
            <div key={category.id} className="category-card-wrapper">
              <button
                type="button"
                className={showAsLocked ? "category-card category-card-locked" : "category-card"}
                style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 97%), hsl(${hue} 55% 91%))` }}
                onClick={() => {
                  if (showAsLocked || isUnlocking) return;
                  playSelectSound();
                  onSelectCategory(category.id);
                }}
                disabled={showAsLocked || isUnlocking}
                aria-label={showAsLocked ? `${category.name}, locked` : `${category.name}, ${unlocked} of ${shapes.length} unlocked`}
              >
                <span className="category-card-icon-wrap">
                  <span className="category-card-icon" aria-hidden="true">
                    {category.icon}
                  </span>
                  {isUnlocking && (
                    <span className="category-card-lock-open-overlay" aria-hidden="true">
                      🔓
                    </span>
                  )}
                </span>
                <span className="category-card-name">{category.name}</span>
                {accessible && (
                  <>
                    <span className="category-card-progress">
                      {unlocked} of {shapes.length} unlocked
                    </span>
                    <div className="category-card-progress-track">
                      <div className="category-card-progress-fill" style={{ width: `${percent}%` }} />
                    </div>
                  </>
                )}
                {showAsLocked && <span className="category-card-lock-badge">🔒 Locked</span>}
              </button>
              {showAsLocked && (
                <Button
                  variant="secondary"
                  className="category-card-unlock-btn"
                  disabled={!canAffordUnlock}
                  onClick={() => handleUnlockCategory(category.id)}
                >
                  Unlock for {CATEGORY_UNLOCK_COST} 🪙
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {resetStep === 0 && (
        <Button variant="danger" onClick={() => setResetStep(1)}>
          Reset Progress
        </Button>
      )}
      {resetStep === 1 && (
        <div className="reset-confirm">
          <p>This will erase all your unlocked shapes and scores, across every category. Are you sure?</p>
          <div className="button-row">
            <Button variant="secondary" onClick={() => setResetStep(0)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setResetStep(2)}>
              Yes, Reset
            </Button>
          </div>
        </div>
      )}
      {resetStep === 2 && (
        <div className="reset-confirm">
          <p>Last chance — this cannot be undone. Reset everything?</p>
          <div className="button-row">
            <Button variant="secondary" onClick={() => setResetStep(0)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmReset}>
              Confirm Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type ShapeMapProps = {
  category: CategoryId;
  progress: ShapeChallengeProgress;
  onSelect: (index: number) => void;
  onBack: () => void;
  justUnlockedIndex: number | null;
  onUnlockAnimationDone: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToInstructions: () => void;
  onNavigateToShop: () => void;
  onNavigateToSpecialChallenge: () => void;
  onNavigateToHome: () => void;
  onNavigateToSettings: () => void;
};

function ShapeMap({
  category,
  progress,
  onSelect,
  onBack,
  justUnlockedIndex,
  onUnlockAnimationDone,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: ShapeMapProps) {
  useEffect(() => {
    if (justUnlockedIndex === null) return;
    const timeoutId = window.setTimeout(onUnlockAnimationDone, 700);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justUnlockedIndex]);

  const shapes = shapesForCategory(category);
  const categoryInfo = CATEGORIES.find((c) => c.id === category)!;
  const levelIndex = getCategoryLevelIndex(progress, category);
  const unlockedCount = Math.min(levelIndex, shapes.length);
  const progressPercent = Math.round((unlockedCount / shapes.length) * 100);
  // The Settings "lock management" cheat toggle makes every tile playable without
  // touching real progress, so the header stat/progress bar above still reflect
  // shapes actually completed, not the override.
  const unlockAllOverride = isUnlockEverythingActive();

  return (
    <div className="screen">
      <AppHeader
        title={categoryInfo.name}
        subtitle={`${unlockedCount} of ${shapes.length} unlocked`}
        onBack={onBack}
        onNavigateToAchievements={onNavigateToAchievements}
        onNavigateToInstructions={onNavigateToInstructions}
        onNavigateToShop={onNavigateToShop}
        onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSettings={onNavigateToSettings}
      />
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="shape-grid">
        {shapes.map((shape, index) => {
          const unlocked = unlockAllOverride || index <= levelIndex;
          const best = progress.bestScores[shape.id];

          if (!unlocked) {
            return (
              <div key={shape.id} className="shape-tile shape-tile-locked" aria-disabled="true" aria-label={`${shape.name} (locked)`}>
                <span className="shape-tile-lock-icon" aria-hidden="true">
                  🔒
                </span>
                <p className="shape-tile-name">{shape.name}</p>
              </div>
            );
          }

          return (
            <button
              key={shape.id}
              type="button"
              className={index === justUnlockedIndex ? "shape-tile shape-tile-unlock" : "shape-tile"}
              onClick={() => {
                playSelectSound();
                onSelect(index);
              }}
            >
              <ShapePreviewIcon shape={shape} />
              <p className="shape-tile-name">{shape.name}</p>
              {best !== undefined && (
                <>
                  <p className="shape-tile-best">Best: {best}%</p>
                  <StarRating score={best} />
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ShapePlayProps = {
  category: CategoryId;
  levelIndex: number;
  progress: ShapeChallengeProgress;
  onProgressChange: (progress: ShapeChallengeProgress) => void;
  onNextShape: (index: number) => void;
  onBackToMap: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToInstructions: () => void;
  onNavigateToShop: () => void;
  onNavigateToSpecialChallenge: () => void;
  onNavigateToHome: () => void;
  onNavigateToSettings: () => void;
};

function ShapePlay({
  category,
  levelIndex,
  progress,
  onProgressChange,
  onNextShape,
  onBackToMap,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: ShapePlayProps) {
  const shapes = useMemo(() => shapesForCategory(category), [category]);
  const shape = shapes[levelIndex];
  const target = useMemo(() => shape.generate(CANVAS_SIZE), [shape]);
  const bestScore = progress.bestScores[shape.id];
  const passScore = useMemo(() => passScoreForDifficulty(getDifficulty()), []);
  const categoryLevelIndex = getCategoryLevelIndex(progress, category);

  const [phase, setPhase] = useState<Phase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [guideEnabled, setGuideEnabled] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [previousBest, setPreviousBest] = useState<number | undefined>(undefined);
  const [doubleOfferAmount, setDoubleOfferAmount] = useState<number | null>(null);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleUndo() {
    canvasRef.current?.undoLastStroke();
  }

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  function handleDoubleOfferResolved(finalAmount: number, anchorEl: HTMLElement | null) {
    addCoins(finalAmount);
    triggerCoinFlight(anchorEl ?? document.querySelector(".score-total"));
    setDoubleOfferAmount(null);
  }

  function handleDone() {
    if (!attemptPath) return;
    setPreviousBest(bestScore); // remember the best score as it stood before this attempt
    primeAudioContext(); // resume/create the AudioContext during this direct user gesture
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(target, attemptPath);
      const beatBest = bestScore === undefined || scoreResult.total > bestScore;
      const passedNow = scoreResult.total >= passScore;
      const advancesFrontier = passedNow && levelIndex === categoryLevelIndex;

      const updatedProgress: ShapeChallengeProgress = {
        levelIndexByCategory: {
          ...progress.levelIndexByCategory,
          [category]: advancesFrontier ? categoryLevelIndex + 1 : categoryLevelIndex,
        },
        bestScores: { ...progress.bestScores, [shape.id]: beatBest ? scoreResult.total : bestScore! },
      };
      saveProgress(updatedProgress);
      // Recorded before onProgressChange so that achievement detection (which
      // reads shouldShowAchievementsTutorial to decide whether to suppress the
      // "First Steps" banner in favor of the achievements tutorial) already
      // sees this round counted.
      recordRoundCompleted();
      if (passedNow) recordSuccessfulDrawing();
      onProgressChange(updatedProgress);
      // Pay out only the improvement over the shape's previous best - not the full
      // reward for the new star tier every time. Otherwise climbing 3 stars, then
      // 5 stars, on the same shape would pay both tiers in full (35 + 80), more
      // than acing it in one attempt (80) ever would. Replaying at the same or a
      // lower star count earns nothing, since the delta is zero or negative.
      const previousStars = bestScore !== undefined ? starRatingForScore(bestScore) : -1;
      const newStars = starRatingForScore(scoreResult.total);
      const starCoins = coinsForStars(newStars) - coinsForStars(previousStars);
      if (starCoins > 0) setDoubleOfferAmount(starCoins);

      setResult(scoreResult);
      setIsNewBest(beatBest);
      setFeedbackMessage(passedNow ? randomCelebrationMessage() : randomEncouragementMessage());
      if (passedNow) playSuccessSound();
      else playEncourageSound();
      setPhase("result");
    }, delay);
  }

  function handleTryAgain() {
    setAttemptPath(null);
    setResult(null);
    setIsNewBest(false);
    setFeedbackMessage(null);
    setDoubleOfferAmount(null);
    setPhase("preview");
  }

  const nextIndex = levelIndex + 1;
  // Next shape is reachable either because this attempt just unlocked it (frontier pass)
  // or because it was already unlocked from a previous pass (replaying an old shape).
  const canGoToNextShape = nextIndex < shapes.length && nextIndex <= categoryLevelIndex;
  const bestLabel = bestScore === undefined ? "—" : String(bestScore);
  const showTargetGhost = phase === "preview" || (phase === "drawing" && guideEnabled);

  if (phase === "result" && result && attemptPath) {
    const passed = result.total >= passScore;
    return (
      <div className="screen">
        <AppHeader
          onNavigateToHome={onNavigateToHome}
          onNavigateToInstructions={onNavigateToInstructions}
          onNavigateToAchievements={onNavigateToAchievements}
          onNavigateToShop={onNavigateToShop}
          onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
          onNavigateToSettings={onNavigateToSettings}
        />
        {!canGoToNextShape && nextIndex < shapes.length && (
          <p className="form-error">Score {passScore}+ to unlock the next shape.</p>
        )}
        {feedbackMessage && (
          <div className={passed ? "celebration-banner" : "encourage-banner"}>
            {passed ? "🎉 " : "💪 "}
            {feedbackMessage}
          </div>
        )}
        <ScoreCard score={result} isNewBest={isNewBest} />
        <StarRating score={result.total} size={44} />
        {previousBest !== undefined && bestScore !== undefined && (
          <p className="best-summary">
            Your best: <strong>{bestScore}%</strong> <StarRating score={bestScore} size={44} />
          </p>
        )}
        {doubleOfferAmount !== null && <DoubleCoinsOffer amount={doubleOfferAmount} onResolved={handleDoubleOfferResolved} />}
        <div className="canvas-wrapper">
          <ShapeOverlayCanvas target={target} attempt={attemptPath} attemptColor={penColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
        </div>
        <p className="overlay-legend">
          <span className="overlay-legend-swatch overlay-legend-target" /> Target shape
          <span className="overlay-legend-swatch" style={{ background: penColorCssBackground(penColor), marginLeft: "var(--space-3)" }} /> Your
          drawing
        </p>
        {doubleOfferAmount === null && (
          <>
            <div className="button-row">
              <Button variant="secondary" onClick={handleTryAgain}>
                Try Again
              </Button>
              {canGoToNextShape && <Button onClick={() => onNextShape(nextIndex)}>Next Shape</Button>}
            </div>
            <Button variant="secondary" onClick={onBackToMap}>
              Back to Map
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title={shape.name}
        subtitle={`Best: ${bestLabel} · Pass score: ${passScore}+`}
        onBack={onBackToMap}
        onNavigateToAchievements={onNavigateToAchievements}
        onNavigateToInstructions={onNavigateToInstructions}
        onNavigateToShop={onNavigateToShop}
        onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSettings={onNavigateToSettings}
      />
      <p className="status-text">
        {phase === "preview" && "Study the shape"}
        {phase === "drawing" && "Now draw it"}
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
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <>
          <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={onNavigateToShop} />
          <div className="button-row">
            <Button variant="secondary" onClick={() => setGuideEnabled((enabled) => !enabled)}>
              {guideEnabled ? "Hide Guide" : "Show Guide"}
            </Button>
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
