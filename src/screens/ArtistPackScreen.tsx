import { useEffect, useMemo, useRef, useState } from "react";
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
  PREVIEW_DURATION_MS,
  passScoreForDifficulty,
  penColorCssBackground,
  randomCelebrationMessage,
  randomEncouragementMessage,
  type PenColorId,
} from "../app/constants";
import {
  artistOutboundUrl,
  getVisibleArtworks,
  getArtistPackById,
  type ArtistArtworkDefinition,
  type ArtistPackDefinition,
} from "../engine/artistPackLibrary";
import { scoreAttempt } from "../engine/scoring";
import { triggerCoinFlight } from "../engine/coinFlight";
import { playEncourageSound, playSelectSound, playSuccessSound, primeAudioContext } from "../engine/soundEngine";
import { addCoins } from "../services/coinsStore";
import { getDifficulty } from "../services/difficultySettings";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { shareOrCopy } from "../services/nativeShare";
import { trackEvent } from "../services/analytics";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { getArtistPackBestScore, recordArtistPackResult } from "../services/artistPackStore";
import { toAchievements, toArtistPack, toHome, toInstructions, toSettings, toShapeChallenge, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type ArtistPackScreenProps = {
  packId: string;
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

export default function ArtistPackScreen({ packId, from, onNavigate }: ArtistPackScreenProps) {
  const pack = getArtistPackById(packId);
  const [playing, setPlaying] = useState<ArtistArtworkDefinition | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // Bumped after each finished attempt to re-read best scores for the grid.
  const [resultTick, setResultTick] = useState(0);

  const here = toArtistPack(packId, from);
  const goToAchievements = () => onNavigate(toAchievements(here));
  const goToInstructions = () => onNavigate(toInstructions(here));
  const goToShop = (highlightPenColorId?: PenColorId) => onNavigate(toShop(here, highlightPenColorId));
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  const leaveDialogRef = useDialogA11y<HTMLDivElement>(showLeaveConfirm, { onClose: () => setShowLeaveConfirm(false) });

  if (!pack) {
    return (
      <div className="screen">
        <AppHeader title="Artist Pack" onBack={() => onNavigate(from)} onNavigateToHome={goToHome} />
        <p className="status-text">This pack is no longer available.</p>
      </div>
    );
  }

  if (playing) {
    return (
      <ArtistPlay
        artwork={playing}
        pack={pack}
        onFinished={() => {
          setPlaying(null);
          setResultTick((n) => n + 1);
        }}
        onNavigate={onNavigate}
        here={here}
      />
    );
  }

  function handleVisitSite() {
    playSelectSound();
    setShowLeaveConfirm(true);
  }

  function handleConfirmLeave() {
    if (!pack) return;
    trackEvent("artist_pack_link_clicked", {
      artistId: pack.artist.id,
      packId: pack.id,
      hasAffiliate: pack.artist.affiliateUrl !== undefined,
    });
    window.open(artistOutboundUrl(pack.artist), "_blank", "noopener,noreferrer");
    setShowLeaveConfirm(false);
  }

  const passScore = passScoreForDifficulty(getDifficulty());
  // Players only ever see published artwork; in a dev build, drafts/approved are
  // also shown (flagged) so the owner can review unpublished work.
  const visibleArtworks = getVisibleArtworks(pack);
  void resultTick; // best scores below are read fresh on each render after a result

  const header = (
    <AppHeader
      title={pack.name}
      subtitle={`Artist Pack · ${pack.artist.name}`}
      onBack={() => onNavigate(from)}
      onNavigateToHome={goToHome}
      onNavigateToAchievements={goToAchievements}
      onNavigateToInstructions={goToInstructions}
      onNavigateToShop={goToShop}
      onNavigateToShapeChallenge={goToShapeChallenge}
      onNavigateToSettings={goToSettings}
    />
  );

  return (
    <div className="screen">
      {header}

      <section className="artist-profile-card">
        <span className="artist-profile-avatar" aria-hidden="true">
          {pack.artist.avatarIcon}
        </span>
        <div className="artist-profile-text">
          <h2 className="artist-profile-name">{pack.artist.name}</h2>
          <p className="artist-profile-bio">{pack.artist.bio}</p>
          <button type="button" className="artist-profile-link" onClick={handleVisitSite}>
            Visit {pack.artist.name}'s Website ↗
          </button>
        </div>
      </section>

      {visibleArtworks.length === 0 ? (
        <p className="status-text">No artworks are available in this pack yet.</p>
      ) : (
        <div className="shape-grid artist-artwork-grid">
          {visibleArtworks.map((artwork) => {
            const best = getArtistPackBestScore(artwork.id);
            const isPublished = artwork.status === "published";
            return (
              <button
                key={artwork.id}
                type="button"
                className="shape-tile"
                onClick={() => {
                  playSelectSound();
                  setPlaying(artwork);
                }}
                aria-label={`Draw ${artwork.name}, inspired by ${pack.artist.name}${isPublished ? "" : ` (${artwork.status}, dev only)`}`}
              >
                {!isPublished && <span className="artist-artwork-status-badge">{artwork.status} · dev</span>}
                <ShapePreviewIcon shape={artwork} />
                <p className="shape-tile-name">{artwork.name}</p>
                {best !== undefined && (
                  <>
                    <p className="shape-tile-best">Best: {best}%</p>
                    <StarRating score={best} />
                  </>
                )}
                <p className="artist-artwork-credit">🎨 Inspired by {pack.artist.name}</p>
              </button>
            );
          })}
        </div>
      )}

      <p className="artist-pack-passhint status-text">Score {passScore}+ to complete an artwork.</p>

      {showLeaveConfirm && (
        <div className="password-prompt-overlay" onClick={() => setShowLeaveConfirm(false)}>
          <div
            ref={leaveDialogRef}
            className="password-prompt-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artist-leave-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="artist-leave-title">Leaving CYDI</h2>
            <p className="status-text">
              You're about to leave CYDI and open {pack.artist.name}'s website in a new tab. Continue?
            </p>
            <div className="button-row">
              <Button variant="secondary" onClick={() => setShowLeaveConfirm(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmLeave}>Continue ↗</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- play flow (mirrors MegaChallengeScreen's MegaPlay) ----------

type ArtistPhase = "preview" | "drawing" | "analyzing" | "result";

type ArtistPlayProps = {
  artwork: ArtistArtworkDefinition;
  pack: ArtistPackDefinition;
  onFinished: () => void;
  onNavigate: (screen: Screen) => void;
  here: Screen;
};

function ArtistPlay({ artwork, pack, onFinished, onNavigate, here }: ArtistPlayProps) {
  const [phase, setPhase] = useState<ArtistPhase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [doubleOfferAmount, setDoubleOfferAmount] = useState<number | null>(null);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  // The optional draw-along guide (the target ghost) the player can keep on
  // during drawing — mirrors Shape Challenge. It is a non-interactive overlay in
  // DrawingCanvas and never becomes part of the attempt path.
  const [guideEnabled, setGuideEnabled] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  // The Share button and the keep-on guide are enabled for published artworks
  // only for now; a draft/approved artwork previewed in development uses the
  // plain flow (guide shown during the study phase only).
  const isPublished = artwork.status === "published";

  const target = useMemo(() => artwork.generate(CANVAS_SIZE), [artwork]);
  const passScore = passScoreForDifficulty(getDifficulty());
  // Guide stays visible whenever enabled during drawing — it does NOT auto-hide
  // when drawing begins. Scoring is unchanged: the ghost never enters the attempt.
  const showTargetGhost = phase === "preview" || (isPublished && phase === "drawing" && guideEnabled);

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

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
      const outcome = recordArtistPackResult(artwork.id, scoreResult.total);
      if (outcome.starCoins > 0) {
        addCoins(outcome.starCoins);
        setDoubleOfferAmount(outcome.starCoins);
      }
      setResult(scoreResult);
      setFeedbackMessage(passed ? randomCelebrationMessage() : randomEncouragementMessage());
      if (passed) playSuccessSound();
      else playEncourageSound();
      setPhase("result");
    }, delay);
  }

  /** Only the extra half of a successful double is new — the base reward was credited immediately, so leaving mid-offer never forfeits earned coins (same rule as MegaPlay). */
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
    setShareFeedback(null);
    setPhase("preview");
  }

  /** Shares this result via CYDI's standard share sheet (OS share, clipboard
   * fallback). Only the published artwork's name, the pack name, the artist
   * credit, and the score are included — no unpublished content is exposed. */
  async function handleShareResult() {
    if (!result) return;
    const outcome = await shareOrCopy({
      title: `CYDI — ${artwork.name} (${pack.name})`,
      text: `I scored ${result.total}% drawing "${artwork.name}" from the ${pack.name} Artist Pack by ${pack.artist.name} on CYDI!`,
      url: location.origin,
    });
    if (outcome === "copied") {
      setShareFeedback("Link copied!");
      window.setTimeout(() => setShareFeedback(null), 2500);
    } else if (outcome === "failed") {
      setShareFeedback("Couldn't share — please try again.");
      window.setTimeout(() => setShareFeedback(null), 2500);
    }
  }

  const goToAchievements = () => onNavigate(toAchievements(here));
  const goToInstructions = () => onNavigate(toInstructions(here));
  const goToShop = (highlightPenColorId?: PenColorId) => onNavigate(toShop(here, highlightPenColorId));
  const goToShapeChallenge = () => onNavigate(toShapeChallenge());
  const goToHome = () => onNavigate(toHome());
  const goToSettings = () => onNavigate(toSettings());

  const header = (
    <AppHeader
      title={artwork.name}
      subtitle={`🎨 Inspired by ${pack.artist.name}`}
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
        <StarRating score={result.total} size={44} />
        {doubleOfferAmount !== null && <DoubleCoinsOffer amount={doubleOfferAmount} onResolved={handleDoubleOfferResolved} />}
        <div className="canvas-wrapper">
          <ShapeOverlayCanvas target={target} attempt={attemptPath} attemptColor={penColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
        </div>
        <p className="overlay-legend">
          <span className="overlay-legend-swatch overlay-legend-target" /> Target artwork
          <span
            className="overlay-legend-swatch"
            style={{ background: penColorCssBackground(penColor), marginLeft: "var(--space-3)" }}
          />{" "}
          Your drawing
        </p>
        <p className="artist-artwork-credit artist-artwork-credit-result">🎨 Inspired by {pack.artist.name}</p>
        {shareFeedback && <p className="status-text">{shareFeedback}</p>}
        {doubleOfferAmount === null && (
          <div className="button-row">
            <Button variant="secondary" onClick={handleRetry}>
              Try Again
            </Button>
            {isPublished && (
              <Button variant="secondary" onClick={handleShareResult}>
                🔗 Share
              </Button>
            )}
            <Button onClick={onFinished}>Back to Pack</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      <p className="status-text canvas-instruction-text">
        {phase === "preview" && "Study the artwork"}
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
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <>
          <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={goToShop} />
          <div className="button-row">
            {isPublished && (
              <Button variant="secondary" onClick={() => setGuideEnabled((enabled) => !enabled)}>
                {guideEnabled ? "Hide Guide" : "Show Guide"}
              </Button>
            )}
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
