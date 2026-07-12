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
  DEFAULT_PEN_COLOR,
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
  resolvePublishedArtwork,
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
import { encodeArtistResultLink, type DecodedSharedArtistResult } from "../services/shareLink";
import { createShortArtistResultLink } from "../services/shareApi";
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
  /** Present when arriving via "Draw It Back" on a received shared result - drops straight into that artwork instead of the grid, and changes where Back/finish return to. */
  replyTo?: DecodedSharedArtistResult;
  onNavigate: (screen: Screen) => void;
};

export default function ArtistPackScreen({ packId, from, replyTo, onNavigate }: ArtistPackScreenProps) {
  const pack = getArtistPackById(packId);
  // Resolved before any hooks (rules-of-hooks) - never falls back to any other
  // artwork or the grid; a replyTo that doesn't resolve is handled by a
  // dedicated "unavailable" screen below, not a silent substitution.
  const replyArtwork = pack && replyTo?.artworkId ? resolvePublishedArtwork(packId, replyTo.artworkId) : undefined;
  const [playing, setPlaying] = useState<ArtistArtworkDefinition | null>(() => replyArtwork ?? null);
  // Never reassigned after mount - a reply session always fully navigates away on
  // finish/back (see handleFinishedPlaying) rather than returning to this same
  // screen instance with `playing` cleared, so there's no later point where this
  // would need to flip back to false.
  const playingViaReply = Boolean(replyArtwork);
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

  // A replyTo that doesn't resolve (stale/removed artwork id, or an old link
  // with none at all) never falls back to the grid or any other artwork -
  // shown as its own dead-end state, same "go back to where you came from"
  // pattern as the pack-not-found case above.
  if (replyTo && !replyArtwork) {
    return (
      <div className="screen">
        <AppHeader title="Artist Pack" onBack={() => onNavigate(from)} onNavigateToHome={goToHome} />
        <p className="status-text">This artwork is no longer available.</p>
        <div className="button-row">
          <Button onClick={() => onNavigate(from)}>Back</Button>
        </div>
      </div>
    );
  }

  /** Reply sessions skip the grid entirely (arrived via "Draw It Back"), so finishing/backing out returns straight to the received shared-result screen instead - the same already-decoded data, no re-fetch. */
  function handleFinishedPlaying() {
    if (playingViaReply) {
      onNavigate(from);
      return;
    }
    setPlaying(null);
    setResultTick((n) => n + 1);
  }

  if (playing) {
    return (
      <ArtistPlay
        artwork={playing}
        pack={pack}
        replyTo={playingViaReply ? replyTo : undefined}
        onFinished={handleFinishedPlaying}
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
      artistKey: pack.artist.id,
      packKey: pack.id,
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
        {pack.artist.avatarImageUrl ? (
          <span className="artist-profile-avatar">
            <img
              className="artist-profile-avatar-img"
              src={pack.artist.avatarImageUrl}
              alt={pack.artist.avatarImageAlt}
            />
          </span>
        ) : (
          <span className="artist-profile-avatar" aria-hidden="true">
            {pack.artist.avatarIcon}
          </span>
        )}
        <div className="artist-profile-text">
          <h2 className="artist-profile-name">{pack.artist.name}</h2>
          <p className="artist-profile-bio">{pack.artist.bio}</p>
          <button type="button" className="artist-profile-link" onClick={handleVisitSite}>
            Visit {pack.artist.name}'s Website ↗
          </button>
        </div>
      </section>

      {visibleArtworks.length === 0 ? (
        <div className="artist-pack-lock">
          <p className="artist-pack-coming-soon-title">Coming Soon</p>
          <p className="status-text">New artworks from {pack.artist.name} are on the way.</p>
        </div>
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

// ---------- share message copy ----------

/** Keeps admin-authored catalog names on one line and non-empty before they're
 * dropped into a shared message - defensive, since this data ultimately comes
 * from static source (artistPackLibrary.ts), not user input. */
function sanitizeForShareText(value: string, fallback: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function buildArtistShareMessage(scoreTotal: number, artworkName: string, artistName: string): string {
  const safeArtwork = sanitizeForShareText(artworkName, "this artwork");
  const safeArtist = sanitizeForShareText(artistName, "");
  const credit = safeArtist ? ` by ${safeArtist}` : "";
  return `I scored ${scoreTotal}% on “${safeArtwork}”${credit} in CYDI. Think you can beat me? Draw it back! 🎨`;
}

function buildArtistReplyShareMessage(scoreTotal: number, artworkName: string): string {
  const safeArtwork = sanitizeForShareText(artworkName, "this artwork");
  return `I drew it back and scored ${scoreTotal}% on “${safeArtwork}”. Can you beat my score? Your turn! 🎨`;
}

// ---------- play flow (mirrors MegaChallengeScreen's MegaPlay) ----------

type ArtistPhase = "preview" | "drawing" | "analyzing" | "result";

type ArtistPlayProps = {
  artwork: ArtistArtworkDefinition;
  pack: ArtistPackDefinition;
  /** Set only for a "Draw It Back" session - the original sender's own attempt/color, shown compared against the recipient's new drawing once they finish (never the real artwork guide). */
  replyTo?: DecodedSharedArtistResult;
  onFinished: () => void;
  onNavigate: (screen: Screen) => void;
  here: Screen;
};

function ArtistPlay({ artwork, pack, replyTo, onFinished, onNavigate, here }: ArtistPlayProps) {
  const isReply = replyTo !== undefined;
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
    const timeoutId = window.setTimeout(() => {
      trackEvent("game_started", { gameType: "artistPack", category: artwork.category, contentKey: `${pack.id}:${artwork.id}` });
      setPhase("drawing");
    }, PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase, artwork, pack]);

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
      trackEvent("game_completed", { gameType: "artistPack", category: artwork.category, contentKey: `${pack.id}:${artwork.id}` });
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
   * fallback), backed by a KV short link (with a self-contained hash link as the
   * offline fallback). The link opens a dedicated result page showing ONLY the
   * player's own drawing — the reference artwork and the draw-along guide are
   * never included in the payload, so nothing leaks even if Show Guide was on.
   * Guarded to published artwork only, so drafts/approved are never shareable.
   * Always carries only THIS player's own attempt - in a reply ("Send Back")
   * session, `replyTo.attempt` (the sender's drawing) is never included here,
   * only shown locally in the result comparison below.
   *
   * The share link is appended directly to the message text (rather than passed
   * as a separate Web Share `url`), and that exact same combined string is what
   * the clipboard fallback copies - so the message is identical everywhere,
   * with no risk of a share target appending the link a second time. */
  async function handleShareResult() {
    if (!result || !attemptPath || !isPublished) return;
    const shareArgs = {
      artworkName: artwork.name,
      packName: pack.name,
      artistName: pack.artist.name,
      packId: pack.id,
      score: result,
      attempt: attemptPath,
      attemptColor: penColor,
      artworkId: artwork.id,
    };
    const url = (await createShortArtistResultLink(shareArgs)) ?? encodeArtistResultLink(shareArgs);
    const scoreTotal = Math.round(result.total);
    const message = isReply
      ? buildArtistReplyShareMessage(scoreTotal, artwork.name)
      : buildArtistShareMessage(scoreTotal, artwork.name, pack.artist.name);
    const fullText = `${message}\n\n${url}`;
    const outcome = await shareOrCopy({
      title: `CYDI — ${sanitizeForShareText(artwork.name, "Artist Pack")}`,
      text: fullText,
    });
    if (outcome === "shared" || outcome === "copied") {
      trackEvent("result_shared", { gameType: "artistPack", category: artwork.category, contentKey: `${pack.id}:${artwork.id}` });
    }
    if (outcome === "copied") {
      setShareFeedback("Link copied!");
      window.setTimeout(() => setShareFeedback(null), 2500);
    } else if (outcome === "failed") {
      setShareFeedback(`Couldn't share automatically — copy this: ${fullText}`);
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
          {isReply && replyTo ? (
            // Reply comparison: sender's drawing vs. the recipient's new one - never
            // the real artwork guide/target, reusing the same generic overlay used
            // elsewhere to compare two hand-drawn paths (e.g. SharedResultScreen).
            <ShapeOverlayCanvas target={replyTo.attempt} attempt={attemptPath} attemptColor={penColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
          ) : (
            <ShapeOverlayCanvas target={target} attempt={attemptPath} attemptColor={penColor} width={CANVAS_SIZE} height={CANVAS_SIZE} />
          )}
        </div>
        <p className="overlay-legend">
          {isReply && replyTo ? (
            <span
              className="overlay-legend-swatch overlay-legend-target"
              style={{ background: penColorCssBackground(replyTo.attemptColor ?? DEFAULT_PEN_COLOR) }}
            />
          ) : (
            <span className="overlay-legend-swatch overlay-legend-target" />
          )}{" "}
          {isReply ? "Sender's drawing" : "Target artwork"}
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
                {isReply ? "↩️ Send Back" : "🔗 Share"}
              </Button>
            )}
            <Button onClick={onFinished}>{isReply ? "Back" : "Back to Pack"}</Button>
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
