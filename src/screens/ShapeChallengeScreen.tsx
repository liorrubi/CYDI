import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import CoinIndicator from "../components/CoinIndicator";
import DrawingCanvas from "../components/DrawingCanvas";
import ScoreCard from "../components/ScoreCard";
import ShapeOverlayCanvas from "../components/ShapeOverlayCanvas";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import SoundToggleButton from "../components/SoundToggleButton";
import StarRating from "../components/StarRating";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  DIFFICULTY_LEVELS,
  PREVIEW_DURATION_MS,
  coinsForStars,
  journeyRankForPercent,
  passScoreForDifficulty,
  randomCelebrationMessage,
  randomEncouragementMessage,
  starRatingForScore,
} from "../app/constants";
import { computeAchievementStats, findNewlyUnlockedAchievements } from "../app/achievements";
import { CATEGORIES, SHAPE_LIBRARY, shapesForCategory, type CategoryId } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import { playEncourageSound, playSelectSound, playSuccessSound, primeAudioContext } from "../engine/soundEngine";
import { getUnlockedAchievementIds, markAchievementUnlocked } from "../services/achievementsStore";
import { addCoins } from "../services/coinsStore";
import { getDifficulty, setDifficulty } from "../services/difficultySettings";
import {
  clearProgress,
  getCategoryLevelIndex,
  getProgress,
  saveProgress,
  type ShapeChallengeProgress,
} from "../services/shapeChallengeProgress";
import { toAchievements, toHome } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "preview" | "drawing" | "analyzing" | "result";

type ShapeChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

function checkAndAwardAchievements(progress: ShapeChallengeProgress): void {
  const stats = computeAchievementStats(progress);
  const unlockedIds = getUnlockedAchievementIds();
  for (const achievement of findNewlyUnlockedAchievements(stats, unlockedIds)) {
    markAchievementUnlocked(achievement.id);
    addCoins(achievement.coinReward);
  }
}

export default function ShapeChallengeScreen({ onNavigate }: ShapeChallengeScreenProps) {
  const [progress, setProgress] = useState<ShapeChallengeProgress>(() => getProgress());
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [justUnlockedIndex, setJustUnlockedIndex] = useState<number | null>(null);

  // Retroactively award any achievements already satisfied by existing progress.
  useEffect(() => {
    checkAndAwardAchievements(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProgressChange(category: CategoryId, updated: ShapeChallengeProgress) {
    setProgress((prev) => {
      if (updated.levelIndexByCategory[category] > (prev.levelIndexByCategory[category] ?? 0)) {
        setJustUnlockedIndex(updated.levelIndexByCategory[category]);
      }
      return updated;
    });
    checkAndAwardAchievements(updated);
  }

  function handleResetProgress() {
    setProgress(clearProgress());
    setJustUnlockedIndex(null);
  }

  const goToAchievements = () => onNavigate(toAchievements());

  if (selectedCategory === null) {
    return (
      <CategoryListScreen
        progress={progress}
        onSelectCategory={setSelectedCategory}
        onBack={() => onNavigate(toHome())}
        onResetProgress={handleResetProgress}
        onNavigateToAchievements={goToAchievements}
      />
    );
  }

  if (selectedIndex === null) {
    return (
      <ShapeMap
        category={selectedCategory}
        progress={progress}
        onSelect={setSelectedIndex}
        onBack={() => setSelectedCategory(null)}
        justUnlockedIndex={justUnlockedIndex}
        onUnlockAnimationDone={() => setJustUnlockedIndex(null)}
        onNavigateToAchievements={goToAchievements}
      />
    );
  }

  return (
    <ShapePlay
      key={`${selectedCategory}-${selectedIndex}`}
      category={selectedCategory}
      levelIndex={selectedIndex}
      progress={progress}
      onProgressChange={(updated) => handleProgressChange(selectedCategory, updated)}
      onNextShape={setSelectedIndex}
      onBackToMap={() => setSelectedIndex(null)}
      onNavigateToAchievements={goToAchievements}
    />
  );
}

type CategoryListScreenProps = {
  progress: ShapeChallengeProgress;
  onSelectCategory: (category: CategoryId) => void;
  onBack: () => void;
  onResetProgress: () => void;
  onNavigateToAchievements: () => void;
};

function CategoryListScreen({
  progress,
  onSelectCategory,
  onBack,
  onResetProgress,
  onNavigateToAchievements,
}: CategoryListScreenProps) {
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [difficulty, setDifficultyState] = useState(() => getDifficulty());

  function handleConfirmReset() {
    onResetProgress();
    setResetStep(0);
  }

  function handleSelectDifficulty(level: (typeof DIFFICULTY_LEVELS)[number]["id"]) {
    playSelectSound();
    setDifficulty(level);
    setDifficultyState(level);
  }

  const totalUnlocked = Object.values(progress.levelIndexByCategory).reduce((sum, n) => sum + n, 0);
  const totalShapes = SHAPE_LIBRARY.length;
  const overallPercent = Math.round((totalUnlocked / totalShapes) * 100);
  const rank = journeyRankForPercent(overallPercent);

  return (
    <div className="screen">
      <AppHeader title="Shape Challenge" onBack={onBack} onNavigateToAchievements={onNavigateToAchievements} />
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

      <div className="difficulty-picker">
        <p className="difficulty-picker-label">Difficulty</p>
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

      <div className="category-grid">
        {CATEGORIES.map((category) => {
          const shapes = shapesForCategory(category.id);
          const unlocked = Math.min(getCategoryLevelIndex(progress, category.id), shapes.length);
          return (
            <button
              key={category.id}
              type="button"
              className="category-card"
              onClick={() => {
                playSelectSound();
                onSelectCategory(category.id);
              }}
            >
              <span className="category-card-icon" aria-hidden="true">
                {category.icon}
              </span>
              <span className="category-card-name">{category.name}</span>
              <span className="category-card-progress">
                {unlocked} of {shapes.length} unlocked
              </span>
            </button>
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
};

function ShapeMap({
  category,
  progress,
  onSelect,
  onBack,
  justUnlockedIndex,
  onUnlockAnimationDone,
  onNavigateToAchievements,
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

  return (
    <div className="screen">
      <AppHeader
        title={categoryInfo.name}
        subtitle={`${unlockedCount} of ${shapes.length} unlocked`}
        onBack={onBack}
        onNavigateToAchievements={onNavigateToAchievements}
      />
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="shape-grid">
        {shapes.map((shape, index) => {
          const unlocked = index <= levelIndex;
          const best = progress.bestScores[shape.id];

          if (!unlocked) {
            return (
              <div key={shape.id} className="shape-tile shape-tile-locked" aria-disabled="true">
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
              onClick={() => onSelect(index)}
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
};

function ShapePlay({
  category,
  levelIndex,
  progress,
  onProgressChange,
  onNextShape,
  onBackToMap,
  onNavigateToAchievements,
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

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

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
      onProgressChange(updatedProgress);
      addCoins(coinsForStars(starRatingForScore(scoreResult.total)));

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
        <div className="app-header-actions">
          <button
            type="button"
            className="achievements-shortcut"
            onClick={onNavigateToAchievements}
            aria-label="Achievements"
          >
            🏆
          </button>
          <CoinIndicator />
          <SoundToggleButton />
        </div>
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
        <div className="canvas-wrapper">
          <ShapeOverlayCanvas target={target} attempt={attemptPath} width={CANVAS_SIZE} height={CANVAS_SIZE} />
        </div>
        <p className="overlay-legend">
          <span className="overlay-legend-swatch overlay-legend-target" /> Target shape
          <span className="overlay-legend-swatch overlay-legend-attempt" /> Your drawing
        </p>
        <div className="button-row">
          <Button variant="secondary" onClick={handleTryAgain}>
            Try Again
          </Button>
          {canGoToNextShape && <Button onClick={() => onNextShape(nextIndex)}>Next Shape</Button>}
        </div>
        <Button variant="secondary" onClick={onBackToMap}>
          Back to Map
        </Button>
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
      />
      <p className="status-text">
        {phase === "preview" && "Study the shape"}
        {phase === "drawing" && "Now draw it"}
        {phase === "analyzing" && "Analyzing..."}
      </p>
      <div className="canvas-wrapper">
        <DrawingCanvas
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          disabled={phase !== "drawing"}
          ghostPath={showTargetGhost ? target : undefined}
          showGhost={showTargetGhost}
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <div className="button-row">
          <Button variant="secondary" onClick={() => setGuideEnabled((enabled) => !enabled)}>
            {guideEnabled ? "Hide Guide" : "Show Guide"}
          </Button>
          <Button onClick={handleDone}>Done</Button>
        </div>
      )}
    </div>
  );
}
