import { useEffect, useMemo, useRef, useState } from "react";
import AchievementUnlockedBanner from "../components/AchievementUnlockedBanner";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DoubleCoinsOffer from "../components/DoubleCoinsOffer";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import DrawingTutorialOverlay from "../components/DrawingTutorialOverlay";
import PenColorMenu from "../components/PenColorMenu";
import PenSkinMenu from "../components/PenSkinMenu";
import ScoreCard from "../components/ScoreCard";
import ClassicResultNative from "../app/ClassicResultNative";
import ClassicGameplayNative from "../app/ClassicGameplayNative";
import { solidTargetInPreview } from "../app/targetRendering";
import { Capacitor } from "@capacitor/core";
import ResultComparison from "../components/ResultComparison";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import StarRating from "../components/StarRating";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  CATEGORY_UNLOCK_COST,
  FIRST_ROUND_PREVIEW_DURATION_MS,
  PREVIEW_DURATION_MS,
  improvementTip,
  journeyRankForPercent,
  passScoreForDifficulty,
  penInkGlyphColor,
  randomCelebrationMessage,
  randomEncouragementMessage,
  starRatingForScore,
  type PenColorId,
  type PenSkinId,
} from "../app/constants";
import { computeAchievementStats, findNewlyUnlockedAchievements, type Achievement } from "../app/achievements";
import {
  getAllShapes,
  getCategories,
  getCategoryById,
  getShapesForCategory,
  type CategoryId,
} from "../content/contentRepository";
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
import { getSelectedSkin, setSelectedSkin } from "../services/penSkinStore";
import {
  createDiscoveryVariant,
  markCreateDiscoveryShown,
  markDrawingTutorialShown,
  markResultActionsTutorialShown,
  isAchievementsTutorialPending,
  shouldShowDrawingTutorial,
  shouldShowFirstRoundCoach,
  shouldShowResultActionsTutorial,
} from "../services/tutorialStore";
import { recordOfferSkipped } from "../app/rewardOfferNudge";
import { isRewardedAdAvailable } from "../services/ads";
import { trackEvent } from "../services/analytics";
import {
  clearProgress,
  getCategoryCompletedCount,
  getFrontierIndex,
  getProgress,
  getTotalCompletedCount,
  isShapeUnlockedAt,
  type ShapeChallengeProgress,
} from "../services/shapeChallengeProgress";
import {
  applyShapeRoundOutcome,
  resolveShapeRound,
  roundCompletedEvent,
  roundGameType,
} from "../app/shapeRoundOutcome";
import { collectedMegaCardCount, isMegaChallengeUnlocked, unlockMegaChallenge } from "../services/megaChallengeStore";
import { getMegaAlbumSize, getPlayerFacingPacks } from "../content/contentRepository";
import { MEGA_CHALLENGE_UNLOCK_COST } from "../app/constants";
import ArtistPackCard from "../components/ArtistPackCard";
import { getArtistPackCompletedCount } from "../services/artistPackStore";
import {
  toAchievements,
  toArtistPack,
  toCreate,
  toHome,
  toInstructions,
  toMegaChallenge,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "preview" | "drawing" | "analyzing" | "result";

type ShapeChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
  /** Web-only: a shape an SEO landing page asks to open on first render (see
   * seo/landingPages.ts). Purely a request - `resolveInitialSelection` honours it
   * only if the player's existing unlock state already allows that shape, or if
   * the page asked for a `practice` round, which grants nothing (see below).
   * Always undefined on Android. */
  initialShape?: { category: CategoryId; shapeId: string; practice?: boolean };
};

/**
 * Turns a landing page's requested shape into the same `{category, index}`
 * selection a tap on its tile would produce - or null (land on the map) if the
 * category or the shape is not already unlocked for this player, or the shape no
 * longer exists in the active catalog.
 *
 * `practice` is the one exception: a page dedicated to a single shape may open
 * that shape even when the player has not reached it, because dropping such a
 * visitor on the map instead means the page does not do what it says. It buys
 * that with `practiceRound` below - the round is scored and shown for real, but
 * persists nothing at all (see app/shapeRoundOutcome.ts) - so it still cannot
 * bypass unlocks, coins or progression.
 */
function resolveInitialSelection(
  initialShape: ShapeChallengeScreenProps["initialShape"],
  progress: ShapeChallengeProgress,
): { category: CategoryId; index: number; practice: boolean } | null {
  if (!initialShape) return null;
  const shapes = getShapesForCategory(initialShape.category);
  const index = shapes.findIndex((shape) => shape.id === initialShape.shapeId);
  if (index === -1) return null;
  if (initialShape.practice) return { category: initialShape.category, index, practice: true };
  if (!getUnlockedCategoryIds().includes(initialShape.category)) return null;
  if (!isShapeUnlockedAt(progress, initialShape.category, shapes, index)) return null;
  return { category: initialShape.category, index, practice: false };
}

/**
 * Whether the player may browse this category's shape map. Mirrors the rule the
 * category list applies to its own tiles - purchased, or already played under
 * the pre-paywall rules - but takes the unlocked list as an argument so the
 * category list can keep feeding it the state that paces its unlock animation.
 */
function isCategoryAccessible(
  progress: ShapeChallengeProgress,
  category: CategoryId,
  unlockedCategoryIds: CategoryId[],
): boolean {
  return unlockedCategoryIds.includes(category) || getCategoryCompletedCount(progress, category) > 0;
}

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

export default function ShapeChallengeScreen({ onNavigate, initialShape }: ShapeChallengeScreenProps) {
  const [progress, setProgress] = useState<ShapeChallengeProgress>(() => getProgress());
  // Resolved once, against this player's real unlock state. Pure (no side
  // effects), so StrictMode's double-invoke is harmless.
  const [initialSelection] = useState(() => resolveInitialSelection(initialShape, progress));
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(initialSelection?.category ?? null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initialSelection?.index ?? null);
  /** True only while the landing page's own practice round is on screen; cleared the moment the player moves anywhere themselves. */
  const [practiceRound, setPracticeRound] = useState(initialSelection?.practice ?? false);
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
    if (isAchievementsTutorialPending()) {
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
    if (getCategoryCompletedCount(updated, category) > getCategoryCompletedCount(progress, category)) {
      // Highlight the tile the pass just unlocked - the new frontier shape.
      setJustUnlockedIndex(getFrontierIndex(updated, category, getShapesForCategory(category)));
    }
    setProgress(updated);
    let newlyUnlocked = detectAndBankNewAchievements(updated);
    // The very first achievement ("First Steps") lands on the same round that
    // triggers the achievements tutorial coach-mark - showing the normal
    // celebratory banner and the tutorial back-to-back would be redundant, so
    // this one case defers to the tutorial instead. Its coins are still
    // banked above regardless; only the banner is skipped.
    //
    // Gated on "still owed" rather than "due this round": the coach-mark now
    // fires on round 2, so checking shouldShow... here would let the banner
    // through on round 1 and bury the first-round coach behind it.
    if (isAchievementsTutorialPending()) {
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
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  const achievementBanner = pendingAchievements[0] && (
    <AchievementUnlockedBanner
      achievement={pendingAchievements[0]}
      onCollect={handleCollectAchievement}
      onDismissed={handleAchievementBannerDismissed}
    />
  );

  // A practice round may sit in a category the player has not unlocked, so leaving
  // that round must not hand them its map: the category's frontier shape would be
  // free to play there, and clearing it would open the whole paid category. Every
  // other route into a map already passes the category list's own gate.
  const canBrowseSelectedCategory =
    selectedCategory !== null && isCategoryAccessible(progress, selectedCategory, getUnlockedCategoryIds());

  if (selectedCategory === null || (selectedIndex === null && !canBrowseSelectedCategory)) {
    return (
      <>
        {achievementBanner}
        <CategoryListScreen
          progress={progress}
          onSelectCategory={setSelectedCategory}
          onBack={() => onNavigate(toHome())}
          onResetProgress={handleResetProgress}
          onNavigateToMegaChallenge={() => onNavigate(toMegaChallenge())}
          onNavigateToArtistPack={(packId) => onNavigate(toArtistPack(packId, toShapeChallenge()))}
          onNavigateToAchievements={goToAchievements}
          onNavigateToInstructions={goToInstructions}
          onNavigateToShop={goToShop}
          onNavigateToSpecialChallenge={goToSpecialChallenge}
          onNavigateToShapeChallenge={goToShapeChallenge}
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
          onNavigateToShapeChallenge={goToShapeChallenge}
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
        practice={practiceRound}
        onProgressChange={(updated) => handleProgressChange(selectedCategory, updated)}
        onNextShape={(index) => {
          setPracticeRound(false);
          setSelectedIndex(index);
        }}
        onBackToMap={() => {
          setPracticeRound(false);
          setSelectedIndex(null);
          // Leaving a practice round whose category is still locked drops the
          // stale category too, so the exit lands on the category list rather
          // than on a map the guard above would only have to take away again.
          if (!canBrowseSelectedCategory) setSelectedCategory(null);
        }}
        onNavigateToAchievements={goToAchievements}
        onNavigateToInstructions={goToInstructions}
        onNavigateToCreate={() => onNavigate(toCreate())}
        onNavigateToShop={(highlightPenColorId, highlightPenSkinId) =>
          onNavigate(toShop(toShapeChallenge(), highlightPenColorId, highlightPenSkinId))
        }
        onNavigateToSpecialChallenge={goToSpecialChallenge}
        onNavigateToShapeChallenge={goToShapeChallenge}
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
  onNavigateToMegaChallenge: () => void;
  onNavigateToArtistPack: (packId: string) => void;
  onNavigateToAchievements: () => void;
  onNavigateToInstructions: () => void;
  onNavigateToShop: () => void;
  onNavigateToSpecialChallenge: () => void;
  onNavigateToShapeChallenge: () => void;
  onNavigateToHome: () => void;
  onNavigateToSettings: () => void;
};

function CategoryListScreen({
  progress,
  onSelectCategory,
  onBack,
  onResetProgress,
  onNavigateToMegaChallenge,
  onNavigateToArtistPack,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToShapeChallenge,
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
  const [megaUnlocked, setMegaUnlocked] = useState(() => isMegaChallengeUnlocked());
  // Shown briefly when the player taps the locked Mega card without enough coins.
  const [showMegaLockMsg, setShowMegaLockMsg] = useState(false);
  // Drives the celebratory unlock overlay; while true the player sees the
  // animation, then we navigate them straight into the album.
  const [megaUnlockCelebrating, setMegaUnlockCelebrating] = useState(false);

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  function handleMegaCardClick() {
    if (megaUnlocked) {
      playSelectSound();
      onNavigateToMegaChallenge();
      return;
    }
    if (coins < MEGA_CHALLENGE_UNLOCK_COST) {
      playEncourageSound();
      setShowMegaLockMsg(true);
      window.setTimeout(() => setShowMegaLockMsg(false), 2600);
      return;
    }
    // Spend only after unlockMegaChallenge() confirms it actually flipped the
    // flag - it returns false if already unlocked, so the charge can never be
    // applied twice.
    if (!unlockMegaChallenge()) {
      setMegaUnlocked(true);
      return;
    }
    spendCoins(MEGA_CHALLENGE_UNLOCK_COST);
    playAchievementUnlockedSound();
    setMegaUnlocked(true);
    setMegaUnlockCelebrating(true);
    window.setTimeout(() => {
      setMegaUnlockCelebrating(false);
      onNavigateToMegaChallenge();
    }, 1900);
  }

  function handleConfirmReset() {
    onResetProgress();
    setResetStep(0);
  }

  // A category with progress already made under the old (pre-paywall) rules
  // stays accessible - the gate only applies to categories the player hasn't
  // touched yet, so this change can never retroactively lock out shapes
  // someone already unlocked by playing. Reads the local unlocked-id state, not
  // the store, so a purchase still reveals only after its lock animation.
  function categoryAccessible(category: CategoryId): boolean {
    return isCategoryAccessible(progress, category, unlockedCategoryIds);
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

  const totalUnlocked = getTotalCompletedCount(progress);
  const totalShapes = getAllShapes().length;
  const overallPercent = Math.round((totalUnlocked / totalShapes) * 100);
  const rank = journeyRankForPercent(overallPercent);
  const megaCollected = collectedMegaCardCount();
  const megaAlbumSize = getMegaAlbumSize();
  const megaPercent = Math.round((megaCollected / megaAlbumSize) * 100);

  return (
    <div className="screen">
      <AppHeader
        title="Shape Challenge"
        onBack={onBack}
        onNavigateToAchievements={onNavigateToAchievements}
        onNavigateToInstructions={onNavigateToInstructions}
        onNavigateToShop={onNavigateToShop}
        onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
        onNavigateToShapeChallenge={onNavigateToShapeChallenge}
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

      <button
        type="button"
        className={megaUnlocked ? "mega-entry-card" : "mega-entry-card mega-entry-card-locked"}
        onClick={handleMegaCardClick}
        aria-label={
          megaUnlocked
            ? `Mega Challenge, ${megaCollected} of ${megaAlbumSize} legendary shapes collected`
            : `Mega Challenge, locked. Unlock for ${MEGA_CHALLENGE_UNLOCK_COST.toLocaleString("en-US")} coins`
        }
      >
        <span className="mega-entry-icon" aria-hidden="true">
          {megaUnlocked ? "🃏" : "🔒"}
        </span>
        <span className="mega-entry-body">
          <span className="mega-entry-header">
            <span className="mega-entry-title">Mega Challenge</span>
            {megaUnlocked ? (
              <span className="mega-entry-count">
                {megaCollected}/{megaAlbumSize}
              </span>
            ) : (
              <span className="mega-entry-cost">🪙 {MEGA_CHALLENGE_UNLOCK_COST.toLocaleString("en-US")}</span>
            )}
          </span>
          <span className="mega-entry-subtitle">Collect legendary shapes in your album</span>
          {megaUnlocked ? (
            <span className="mega-entry-progress-track">
              <span className="mega-entry-progress-fill" style={{ width: `${megaPercent}%` }} />
            </span>
          ) : (
            <span className="mega-entry-unlock-hint">Tap to unlock this special album</span>
          )}
        </span>
        <span className="mega-entry-arrow" aria-hidden="true">
          {megaUnlocked ? "→" : "🔓"}
        </span>
      </button>
      {showMegaLockMsg && (
        <p className="mega-lock-msg" role="alert">
          Need {MEGA_CHALLENGE_UNLOCK_COST.toLocaleString("en-US")} coins to unlock Mega Challenge
        </p>
      )}

      {megaUnlockCelebrating && (
        <div className="mega-unlock-overlay" role="dialog" aria-label="Mega Challenge unlocked">
          <div className="mega-unlock-dialog">
            <span className="mega-unlock-burst" aria-hidden="true">
              🃏
            </span>
            <h2>Mega Challenge Unlocked!</h2>
            <p>The legendary album is yours. Your first card is ready to draw.</p>
          </div>
        </div>
      )}

      <div className="category-grid">
        {getCategories().map((category, index, categories) => {
          const shapes = getShapesForCategory(category.id);
          const unlocked = Math.min(getCategoryCompletedCount(progress, category.id), shapes.length);
          const percent = Math.round((unlocked / shapes.length) * 100);
          const hue = Math.round((index / categories.length) * 360);
          const accessible = categoryAccessible(category.id);
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

      {getPlayerFacingPacks().length > 0 && (
        <section className="artist-packs-section" aria-labelledby="artist-packs-heading">
          <h2 id="artist-packs-heading" className="artist-packs-heading">
            🎨 Artist Packs
          </h2>
          <p className="artist-packs-subtitle">Draw challenges inspired by real artists.</p>
          <div className="artist-packs-grid">
            {getPlayerFacingPacks().map((pack) => (
              <ArtistPackCard
                key={pack.id}
                pack={pack}
                completedCount={getArtistPackCompletedCount(pack)}
                onClick={() => {
                  playSelectSound();
                  onNavigateToArtistPack(pack.id);
                }}
              />
            ))}
          </div>
        </section>
      )}

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
  onNavigateToShapeChallenge: () => void;
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
  onNavigateToShapeChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: ShapeMapProps) {
  useEffect(() => {
    if (justUnlockedIndex === null) return;
    const timeoutId = window.setTimeout(onUnlockAnimationDone, 700);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justUnlockedIndex]);

  const shapes = getShapesForCategory(category);
  const categoryInfo = getCategoryById(category)!;
  const unlockedCount = Math.min(getCategoryCompletedCount(progress, category), shapes.length);
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
        onNavigateToShapeChallenge={onNavigateToShapeChallenge}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSettings={onNavigateToSettings}
      />
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="shape-grid">
        {shapes.map((shape, index) => {
          const unlocked = unlockAllOverride || isShapeUnlockedAt(progress, category, shapes, index);
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
  /** A landing page's one-off round (see resolveInitialSelection): scored and shown for real, but it persists nothing. */
  practice?: boolean;
  onProgressChange: (progress: ShapeChallengeProgress) => void;
  onNextShape: (index: number) => void;
  onBackToMap: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToInstructions: () => void;
  onNavigateToCreate: () => void;
  onNavigateToShop: (highlightPenColorId?: PenColorId, highlightPenSkinId?: PenSkinId) => void;
  onNavigateToSpecialChallenge: () => void;
  onNavigateToShapeChallenge: () => void;
  onNavigateToHome: () => void;
  onNavigateToSettings: () => void;
};

function ShapePlay({
  category,
  levelIndex,
  progress,
  practice = false,
  onProgressChange,
  onNextShape,
  onBackToMap,
  onNavigateToAchievements,
  onNavigateToInstructions,
  onNavigateToCreate,
  onNavigateToShop,
  onNavigateToSpecialChallenge,
  onNavigateToShapeChallenge,
  onNavigateToHome,
  onNavigateToSettings,
}: ShapePlayProps) {
  const shapes = useMemo(() => getShapesForCategory(category), [category]);
  const shape = shapes[levelIndex];
  const target = useMemo(() => shape.generate(CANVAS_SIZE), [shape]);
  const bestScore = progress.bestScores[shape.id];
  const passScore = useMemo(() => passScoreForDifficulty(getDifficulty()), []);
  // The frontier - the first not-yet-completed shape - is the only shape whose pass advances progress.
  const frontierIndex = getFrontierIndex(progress, category, shapes);

  const [phase, setPhase] = useState<Phase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [guideEnabled, setGuideEnabled] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [previousBest, setPreviousBest] = useState<number | undefined>(undefined);
  // One-time "here is how you continue" callout on the result screen. Held in state
  // rather than recomputed per render so it can't appear or vanish mid-screen, and
  // only ever marked as seen when it actually renders (see the effect below).
  // Re-read when a retry starts (handleTryAgain), which is the only way back into a
  // result within one mount - Next Shape remounts ShapePlay via its key - so the
  // callout really is one-time instead of returning on every retry of the same shape.
  const [resultTutorialPending, setResultTutorialPending] = useState(() => shouldShowResultActionsTutorial());
  // Create Challenge discovery. Re-read per round rather than frozen once, so the
  // round-count thresholds and the "already discovered" checks stay current.
  const [createDiscovery, setCreateDiscovery] = useState<ReturnType<typeof createDiscoveryVariant>>(null);
  const [doubleOfferAmount, setDoubleOfferAmount] = useState<number | null>(null);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const [penSkin, setPenSkin] = useState<PenSkinId>(() => getSelectedSkin());
  const [showDrawingTutorial, setShowDrawingTutorial] = useState(false);
  // The inline first-round coach (countdown, "Draw it", "Tap Done", "Tap Next").
  // Frozen at mount: recordRoundCompleted() flips the underlying condition mid-round,
  // but this round stays coached until Next Shape remounts ShapePlay.
  const [firstRoundCoach] = useState(() => shouldShowFirstRoundCoach());
  const resultActionsRef = useRef<HTMLDivElement | null>(null);
  const previewDurationMs = firstRoundCoach ? FIRST_ROUND_PREVIEW_DURATION_MS : PREVIEW_DURATION_MS;
  const [previewSecondsLeft, setPreviewSecondsLeft] = useState(() => Math.ceil(previewDurationMs / 1000));
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  // First time a genuinely new player reaches the canvas, walk them through
  // the drawing controls (pen, guide, undo, done) - shown once, ever.
  useEffect(() => {
    // The coach teaches draw/finish inline this round, so the blocking modal stays
    // out of its way. The flag is NOT burned: a player whose first canvas is
    // elsewhere (Create, Daily) still gets the modal there.
    if (phase === "drawing" && !firstRoundCoach && shouldShowDrawingTutorial()) {
      setShowDrawingTutorial(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function dismissDrawingTutorial() {
    markDrawingTutorialShown();
    setShowDrawingTutorial(false);
  }

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

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => {
      trackEvent("game_started", { gameType: roundGameType(practice), category, contentKey: shape.id });
      setPhase("drawing");
    }, previewDurationMs);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, category, shape]);

  // Coached rounds show a small countdown next to "Look at the shape".
  useEffect(() => {
    if (phase !== "preview" || !firstRoundCoach) return;
    setPreviewSecondsLeft(Math.ceil(previewDurationMs / 1000));
    const intervalId = window.setInterval(() => {
      setPreviewSecondsLeft((seconds) => Math.max(seconds - 1, 0));
    }, 1000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Shown on the result screen only, and only while the round is actually resolved.
  // A coached round always gets it (that's how Instructions -> Start Tutorial can
  // replay it for veterans); the persisted flag still covers the plain first-result case.
  const showResultTutorial = phase === "result" && (resultTutorialPending || firstRoundCoach);

  useEffect(() => {
    if (phase !== "result") return;
    setCreateDiscovery(createDiscoveryVariant());
  }, [phase]);

  // One feature-discovery message at a time. The result-actions tutorial teaches how
  // to continue at all and the ×2 offer is a live decision, so both outrank a
  // discovery nudge - and deferring it here does NOT mark it shown, so it simply
  // returns on the next round.
  const showCreateDiscovery = phase === "result" && createDiscovery !== null && !showResultTutorial && doubleOfferAmount === null;

  // Remembers WHICH prompt was already logged, not merely that one was: a player who
  // reaches the reminder threshold through retries of a single shape - no remount in
  // between - must still have the reminder marked, or it would reappear later and
  // break the "exactly one reminder" rule. A plain boolean would swallow that.
  const createDiscoveryLoggedRef = useRef<ReturnType<typeof createDiscoveryVariant>>(null);
  useEffect(() => {
    if (!showCreateDiscovery || !createDiscovery) return;
    if (createDiscoveryLoggedRef.current === createDiscovery) return;
    createDiscoveryLoggedRef.current = createDiscovery;
    markCreateDiscoveryShown(createDiscovery);
    trackEvent("create_discovery_shown", {});
  }, [showCreateDiscovery, createDiscovery]);

  function handleCreateDiscoveryAccepted() {
    trackEvent("create_discovery_accepted", {});
    onNavigateToCreate();
  }
  // The coached result screen must not point at a button below the fold. On a
  // short phone viewport (~740px) the score card plus the x2 offer push the
  // continue actions off screen, so the round that says "Tap Next" scrolls them
  // into view itself rather than relying on the player to go looking.
  useEffect(() => {
    if (!showResultTutorial) return;
    resultActionsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [showResultTutorial]);

  const resultTutorialLoggedRef = useRef(false);
  useEffect(() => {
    if (!showResultTutorial || resultTutorialLoggedRef.current) return;
    // A practice round's result screen has no Next Shape - the very step this
    // one-time callout exists to teach - so seeing the reduced version here must
    // not spend the player's one showing of the real thing. The hint still renders
    // (it points at the only action there is); it simply is not counted as the
    // tutorial having been given, which is also why it emits no event: that event
    // is defined as at most one per player.
    if (practice) return;
    resultTutorialLoggedRef.current = true;
    markResultActionsTutorialShown();
    trackEvent("result_actions_tutorial_shown", { placement: "shape_challenge_double_reward" });
  }, [showResultTutorial, practice]);

  /** The base reward is already credited where `doubleOfferAmount` is set below - only the extra half of a successful double is new (mirrors ChestRewardOverlay), so navigating away before resolving the offer can never forfeit the coins already earned. */
  function handleDoubleOfferResolved(finalAmount: number, anchorEl: HTMLElement | null) {
    if (doubleOfferAmount !== null && finalAmount > doubleOfferAmount) {
      addCoins(finalAmount - doubleOfferAmount);
    }
    triggerCoinFlight(anchorEl ?? document.querySelector(".score-total"));
    setDoubleOfferAmount(null);
  }

  /**
   * Continuing while the ×2 offer is still open forfeits it: the base coins were
   * already credited when the round scored, so nothing is lost, but the doubling
   * opportunity ends here and the offer must not survive the transition.
   *
   * Recorded through the SAME reward_skipped event the offer's own Skip button
   * uses - not a parallel "abandoned" event - and only while the offer is actually
   * open, so a player who already pressed Skip can never be counted twice.
   */
  function forfeitDoubleOffer() {
    if (doubleOfferAmount === null) return;
    // Same rule the offer's own Skip button uses: the streak only counts a double the
    // player could really have watched an ad for (see recordOfferSkipped).
    recordOfferSkipped(isRewardedAdAvailable());
    trackEvent("reward_skipped", { placement: "shape_challenge_double_reward" });
    setDoubleOfferAmount(null);
  }

  function handleNextShapeFromResult() {
    forfeitDoubleOffer();
    onNextShape(nextIndex);
  }

  function handleTryAgainFromResult() {
    forfeitDoubleOffer();
    handleTryAgain();
  }

  function handleBackToMapFromResult() {
    forfeitDoubleOffer();
    onBackToMap();
  }

  function handleDone() {
    if (!attemptPath) return;
    setPreviousBest(bestScore); // remember the best score as it stood before this attempt
    primeAudioContext(); // resume/create the AudioContext during this direct user gesture
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(target, attemptPath);
      // What this round earned, and what it may write - see app/shapeRoundOutcome.ts.
      // A practice round resolves to `persist: null`, which is what keeps it out of
      // progression, coins, counters and achievements entirely.
      const outcome = resolveShapeRound({
        progress,
        category,
        shapeId: shape.id,
        levelIndex,
        frontierIndex,
        score: scoreResult.total,
        passScore,
        practice,
      });
      const offerAmount = applyShapeRoundOutcome(outcome, onProgressChange);
      if (offerAmount > 0) setDoubleOfferAmount(offerAmount);

      // Practice rounds are reported, never suppressed - but under their own game
      // type and their own completion event, so they can never be counted as
      // normal play (see app/shapeRoundOutcome.ts).
      const newStars = starRatingForScore(scoreResult.total);
      trackEvent(roundCompletedEvent(practice), {
        category,
        starRating: newStars,
        passed: outcome.passed,
        isNewBest: outcome.isNewBest,
      });
      trackEvent("game_completed", { gameType: roundGameType(practice), category, contentKey: shape.id });

      setResult(scoreResult);
      setIsNewBest(outcome.isNewBest);
      setFeedbackMessage(outcome.passed ? randomCelebrationMessage() : randomEncouragementMessage());
      if (outcome.passed) playSuccessSound();
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
    // The callout was already marked as seen when it rendered, so this resolves to
    // false after the first showing - a retry does not repeat it.
    setResultTutorialPending(shouldShowResultActionsTutorial());
    setPhase("preview");
  }

  const nextIndex = levelIndex + 1;
  // Next shape is reachable either because this attempt just unlocked it (frontier pass)
  // or because it was already unlocked from a previous pass (replaying an old shape).
  // A practice round unlocks nothing, so it never offers one.
  const canGoToNextShape = !practice && nextIndex < shapes.length && nextIndex <= frontierIndex;
  const bestLabel = bestScore === undefined ? "—" : String(bestScore);
  const hasStroke = attemptPath !== null && attemptPath.points.length > 0;
  const showTargetGhost = phase === "preview" || (phase === "drawing" && guideEnabled);

  if (phase === "result" && result && attemptPath) {
    const passed = result.total >= passScore;
    const resultTip = improvementTip(result);

    /*
     * The conditional pieces this screen already renders, built once and handed
     * to whichever layout is used - so neither branch re-implements them and the
     * reward, tutorial and discovery behaviour is identical on both.
     */
    const offerNode =
      doubleOfferAmount !== null ? (
        <DoubleCoinsOffer
          amount={doubleOfferAmount}
          onResolved={handleDoubleOfferResolved}
          placement="shape_challenge_double_reward"
          deferExplainer={showResultTutorial}
        />
      ) : null;

    const notesNode = (
      <>
        {!practice && !canGoToNextShape && nextIndex < shapes.length && (
          <p className="result-actions-note">Score {passScore}+ to unlock the next shape.</p>
        )}
        {practice && (
          <p className="result-actions-note">Practice round - this score isn&rsquo;t saved and unlocks nothing.</p>
        )}
        {showResultTutorial && (
          <div className="result-actions-hint-row">
            {canGoToNextShape && <span aria-hidden="true" />}
            <p className="result-actions-tutorial">
              {canGoToNextShape
                ? "\u{1F446} Tap Next to continue."
                : practice
                  ? "\u{1F446} Tap Try Again for another go."
                  : "\u{1F446} Tap Try Again to beat the pass score."}
            </p>
          </div>
        )}
        {showCreateDiscovery && (
          <div className="create-discovery-card">
            <p className="create-discovery-title">✏️ Make your own challenge</p>
            <p className="create-discovery-text">Draw any shape and send it to a friend to see who copies it best.</p>
            <Button variant="secondary" onClick={handleCreateDiscoveryAccepted}>
              Create a Challenge
            </Button>
          </div>
        )}
      </>
    );

    /*
     * ANDROID gets the approved Version B layout. Same data, same handlers and
     * the same decision about which action is primary - only the presentation
     * differs. The web falls through to the existing markup, unchanged.
     */
    if (Capacitor.isNativePlatform()) {
      return (
        <ClassicResultNative
          shapeName={shape.name}
          onBack={handleBackToMapFromResult}
          stage={<ResultComparison target={target} attempt={attemptPath} attemptColor={penColor} variant="dark" />}
          score={result}
          isNewBest={isNewBest}
          stars={<StarRating score={result.total} size={22} />}
          bestLabel={previousBest !== undefined && bestScore !== undefined ? `Your best ${bestScore}%` : null}
          tip={resultTip}
          onPrimary={canGoToNextShape ? handleNextShapeFromResult : handleTryAgainFromResult}
          primaryLabel={canGoToNextShape ? "Next Shape" : "Try Again"}
          primaryClassName={showResultTutorial ? "coach-pulse" : undefined}
          onRetry={canGoToNextShape ? handleTryAgainFromResult : undefined}
          onHome={handleBackToMapFromResult}
          homeLabel="Back to Map"
          actionsRef={resultActionsRef}
          offer={offerNode}
          extras={notesNode}
        />
      );
    }

    return (
      /*
       * `app-result` is a hook for the native skin ONLY, so appShell.css can put
       * this screen's sections in the approved order without moving any JSX.
       *
       * It has to be specific to Classic's result: `.screen` is every screen's
       * root, and seven screens render ResultComparison, so an unscoped reorder
       * would silently rearrange Daily, Mega, Special, Artist Pack and the
       * shared-result screens too - none of which were reviewed for it.
       *
       * Web is unaffected: every rule using this class also requires
       * `.app-shell`, which only exists on native.
       */
      <div className="screen app-result">
        {/* The header's back arrow takes the same exit as the Back to Map button below -
            it must not be a side door that leaves the ×2 offer unresolved and uncounted. */}
        <AppHeader
          onBack={handleBackToMapFromResult}
          onNavigateToHome={onNavigateToHome}
          onNavigateToInstructions={onNavigateToInstructions}
          onNavigateToAchievements={onNavigateToAchievements}
          onNavigateToShop={onNavigateToShop}
          onNavigateToSpecialChallenge={onNavigateToSpecialChallenge}
          onNavigateToShapeChallenge={onNavigateToShapeChallenge}
          onNavigateToSettings={onNavigateToSettings}
        />

        {feedbackMessage && (
          <div className={passed ? "celebration-banner" : "encourage-banner"}>
            {passed ? "🎉 " : "💪 "}
            {feedbackMessage}
          </div>
        )}
        {/* The tip moves below the continue actions (see below) so the reward and
            Next Shape / Try Again stay reachable without scrolling on a phone. */}
        <ScoreCard score={result} isNewBest={isNewBest} showTip={false} />
        <StarRating score={result.total} size={44} />
        {previousBest !== undefined && bestScore !== undefined && (
          <p className="best-summary">
            Your best: <strong>{bestScore}%</strong> <StarRating score={bestScore} size={44} />
          </p>
        )}
        {doubleOfferAmount !== null && (
          <DoubleCoinsOffer
            amount={doubleOfferAmount}
            onResolved={handleDoubleOfferResolved}
            placement="shape_challenge_double_reward"
            deferExplainer={showResultTutorial}
          />
        )}
        {/* The continue actions sit ABOVE the comparison canvas and are no longer
            gated on the ×2 offer being resolved: doubling is a bonus, never a step
            that blocks play. Leaving the offer by continuing forfeits it - see
            forfeitDoubleOffer. */}
        <div className="button-row result-actions" ref={resultActionsRef}>
          {canGoToNextShape ? (
            <>
              <Button variant="secondary" onClick={handleTryAgainFromResult}>
                Try Again
              </Button>
              <Button onClick={handleNextShapeFromResult} className={showResultTutorial ? "coach-pulse" : undefined}>
                Next Shape
              </Button>
            </>
          ) : (
            /* No next shape to offer yet, so retrying IS the way forward - it becomes
               the primary button rather than a secondary one beside a missing CTA. */
            <Button onClick={handleTryAgainFromResult}>Try Again</Button>
          )}
        </div>
        {!practice && !canGoToNextShape && nextIndex < shapes.length && (
          <p className="result-actions-note">Score {passScore}+ to unlock the next shape.</p>
        )}
        {/* A practice round records nothing by design, so the note above would be
            untrue here - say what actually happens instead. */}
        {practice && (
          <p className="result-actions-note">Practice round - this score isn&rsquo;t saved and unlocks nothing.</p>
        )}
        {showResultTutorial && (
          /* Mirrors .button-row's own flex geometry so the finger sits under the
             PRIMARY button rather than under the middle of the row: with two buttons
             the empty cell takes the left half and the hint lands under Next Shape;
             with only Try Again the hint spans the same full width the button does. */
          <div className="result-actions-hint-row">
            {canGoToNextShape && <span aria-hidden="true" />}
            <p className="result-actions-tutorial">
              {canGoToNextShape
                ? "👆 Tap Next to continue."
                : practice
                  ? "👆 Tap Try Again for another go."
                  : "👆 Tap Try Again to beat the pass score."}
            </p>
          </div>
        )}
        {showCreateDiscovery && (
          <div className="create-discovery-card">
            <p className="create-discovery-title">✏️ Make your own challenge</p>
            <p className="create-discovery-text">Draw any shape and send it to a friend to see who copies it best.</p>
            <Button variant="secondary" onClick={handleCreateDiscoveryAccepted}>
              Create a Challenge
            </Button>
          </div>
        )}
        <ResultComparison target={target} attempt={attemptPath} attemptColor={penColor} />
        {resultTip && <p className="score-improvement-tip score-improvement-tip-standalone">💡 {resultTip}</p>}
        <Button variant="secondary" onClick={handleBackToMapFromResult}>
          Back to Map
        </Button>
      </div>
    );
  }

  /*
   * The instruction for this phase, decided exactly where it was decided before
   * - including the rule that the preview countdown appears only in the first
   * coached round. Both layouts print this same string, so neither can drift.
   */
  const instruction = firstRoundCoach
    ? phase === "preview"
      ? `👀 Look at the shape · ${previewSecondsLeft}`
      : phase === "drawing"
        ? hasStroke
          ? "👆 Tap Done when you finish"
          : "✏️ Draw it!"
        : phase === "analyzing"
          ? "Analyzing..."
          : ""
    : phase === "preview"
      ? "Study the shape"
      : phase === "drawing"
        ? "Now draw it"
        : phase === "analyzing"
          ? "Analyzing..."
          : "";

  /*
   * The live drawing surface, built once and shared by both layouts: same props,
   * same backing size, same wrapper class, never remounted mid-round. Nothing
   * about the canvas differs between web and Android.
   */
  const onNativePlatform = Capacitor.isNativePlatform();
  const canvasNode = (
    <div className="canvas-wrapper">
      <DrawingCanvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        disabled={phase !== "drawing"}
        ghostPath={showTargetGhost ? target : undefined}
        showGhost={showTargetGhost}
        /*
         * Solid in Show, dashed in Draw - so the shape to remember does not look
         * like the guide you trace against. `phase === "preview"` only, which is
         * why turning the guide on during Draw still gets the dashed line.
         *
         * Native only: the web Classic layout has not been reviewed for this and
         * keeps the render it has today.
         */
        ghostSolid={solidTargetInPreview(phase === "preview")}
        strokeColor={penColor}
        penSkin={penSkin}
        onChange={setAttemptPath}
        onComplete={setAttemptPath}
      />
    </div>
  );

  const inkControl = (
    <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={onNavigateToShop} />
  );
  const penControl = (
    <PenSkinMenu
      selected={penSkin}
      inkColor={penInkGlyphColor(penColor)}
      onSelect={handleSelectPenSkin}
      onLockedSkinClick={(id) => onNavigateToShop(undefined, id)}
    />
  );

  /*
   * ANDROID gets the approved Show/Draw layout. Same phases, same strings, same
   * controls, same handlers - only the arrangement differs. The web falls
   * through to the existing markup below, unchanged.
   */
  if (onNativePlatform) {
    return (
      <ClassicGameplayNative
        phase={phase === "result" ? "analyzing" : phase}
        shapeName={shape.name}
        subtitle={`Best: ${bestLabel} · Pass score: ${passScore}+`}
        onBack={onBackToMap}
        onNavigateToShop={() => onNavigateToShop()}
        /*
         * ONE canvas for the whole round. There is no separate Show stage: this
         * same element already draws the target during preview (see
         * `showTargetGhost` above), so Show and Draw are not two surfaces that
         * resemble each other - they are the same node, at the same position and
         * size, with the ghost lifting when the drawing starts.
         *
         * An earlier pass layered a dark overlay canvas over this during
         * preview. On the device that broke the thing it was meant to serve: the
         * two phases read as different screens instead of one surface changing
         * state. Removed.
         */
        canvas={canvasNode}
        instruction={instruction}
        coached={firstRoundCoach}
        inkControl={inkControl}
        penControl={penControl}
        onUndo={handleUndo}
        undoDisabled={!attemptPath || attemptPath.points.length === 0}
        guideEnabled={guideEnabled}
        onToggleGuide={() => setGuideEnabled((enabled) => !enabled)}
        onDone={handleDone}
        donePulse={firstRoundCoach && hasStroke}
        overlays={showDrawingTutorial && <DrawingTutorialOverlay onDismiss={dismissDrawingTutorial} />}
      />
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
        onNavigateToShapeChallenge={onNavigateToShapeChallenge}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSettings={onNavigateToSettings}
      />
      {firstRoundCoach ? (
        /* Coached round: same single status line, never a blocking overlay. */
        <p className={`status-text canvas-instruction-text${phase !== "analyzing" ? " coach-hint" : ""}`}>
          {phase === "preview" && `👀 Look at the shape · ${previewSecondsLeft}`}
          {phase === "drawing" && (hasStroke ? "👆 Tap Done when you finish" : "✏️ Draw it!")}
          {phase === "analyzing" && "Analyzing..."}
        </p>
      ) : (
        <p className="status-text canvas-instruction-text">
          {phase === "preview" && "Study the shape"}
          {phase === "drawing" && "Now draw it"}
          {phase === "analyzing" && "Analyzing..."}
        </p>
      )}
      {canvasNode}
      {phase === "drawing" && (
        <>
          <div className="pen-tools-row">
            {inkControl}
            {penControl}
          </div>
          <div className="button-row">
            <Button variant="secondary" onClick={() => setGuideEnabled((enabled) => !enabled)}>
              {guideEnabled ? "Hide Guide" : "Show Guide"}
            </Button>
            <Button variant="secondary" onClick={handleUndo} disabled={!attemptPath || attemptPath.points.length === 0}>
              Undo
            </Button>
            <Button onClick={handleDone} className={firstRoundCoach && hasStroke ? "coach-pulse" : undefined}>
              Done
            </Button>
          </div>
        </>
      )}
      {showDrawingTutorial && <DrawingTutorialOverlay onDismiss={dismissDrawingTutorial} />}
    </div>
  );
}
