import { useEffect, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import { solidTargetInPreview } from "../app/targetRendering";
import DrawingTutorialOverlay from "../components/DrawingTutorialOverlay";
import PenColorMenu from "../components/PenColorMenu";
import PenSkinMenu from "../components/PenSkinMenu";
import ResultScreen from "./ResultScreen";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  FIRST_ROUND_PREVIEW_DURATION_MS,
  PREVIEW_DURATION_MS,
  penInkGlyphColor,
  type PenColorId,
  type PenSkinId,
} from "../app/constants";
import { getChallenge, updateChallenge } from "../services/challengeStorage";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { getSelectedSkin, setSelectedSkin } from "../services/penSkinStore";
import { encodeResultLink } from "../services/shareLink";
import { createShortResultLink } from "../services/shareApi";
import { shareOrCopy } from "../services/nativeShare";
import { trackEvent } from "../services/analytics";
import { markDrawingTutorialShown, shouldShowDrawingTutorial } from "../services/tutorialStore";
import { scoreAttempt } from "../engine/scoring";
import {
  toAchievements,
  toCreate,
  toHome,
  toInstructions,
  toList,
  toPlay,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { Challenge, DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "preview" | "drawing" | "analyzing" | "result";

type PlayChallengeScreenProps = {
  challengeId: string;
  /** Where Back goes - see toPlay(). Undefined keeps the historical My Challenges target. */
  from?: Screen;
  onNavigate: (screen: Screen) => void;
};

export default function PlayChallengeScreen({ challengeId, from, onNavigate }: PlayChallengeScreenProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(() => getChallenge(challengeId));
  const [phase, setPhase] = useState<Phase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [previousBest, setPreviousBest] = useState<number | undefined>(undefined);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const [penSkin, setPenSkin] = useState<PenSkinId>(() => getSelectedSkin());
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  // Opened before the preview rather than when drawing starts: the target is only ever
  // visible during the preview (there is no guide to fall back on here), so a walkthrough
  // that interrupts afterwards costs a first-time player their one look at the shape.
  // The preview timer below waits for this to close, so the sequence is explain -> full
  // preview -> draw.
  const [showDrawingTutorial, setShowDrawingTutorial] = useState(() => shouldShowDrawingTutorial());
  // The whole first-visit treatment - longer preview and inline hints - hangs off the same
  // one-shot flag as the tutorial above, deliberately NOT off completedRounds: that counter
  // is only ever advanced by Shape Challenge, so a player who only ever opens friends'
  // challenges would sit at 0 forever and be coached again every single time.
  const [isCoachedFirstVisit] = useState(() => shouldShowDrawingTutorial());
  const previewDurationMs = isCoachedFirstVisit ? FIRST_ROUND_PREVIEW_DURATION_MS : PREVIEW_DURATION_MS;
  const backTarget = from ?? toList();
  const hasStroke = attemptPath !== null && attemptPath.points.length > 0;

  function dismissDrawingTutorial() {
    markDrawingTutorialShown();
    setShowDrawingTutorial(false);
  }

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleLockedColorClick(id: PenColorId) {
    onNavigate(toShop(toPlay(challengeId, from), id));
  }

  function handleSelectPenSkin(id: PenSkinId) {
    setSelectedSkin(id);
    setPenSkin(id);
  }

  function handleLockedSkinClick(id: PenSkinId) {
    onNavigate(toShop(toPlay(challengeId, from), undefined, id));
  }

  function handleUndo() {
    canvasRef.current?.undoLastStroke();
  }

  useEffect(() => {
    if (!challenge || phase !== "preview" || showDrawingTutorial) return;
    const timeoutId = window.setTimeout(() => {
      trackEvent("game_started", { gameType: "customChallenge", category: "custom", contentKey: challenge.id });
      setPhase("drawing");
    }, previewDurationMs);
    return () => window.clearTimeout(timeoutId);
  }, [challenge, phase, showDrawingTutorial, previewDurationMs]);

  function handleDone() {
    if (!attemptPath || !challenge) return;
    setPreviousBest(challenge.personalBest); // remember the best score as it stood before this attempt
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(challenge.target, attemptPath);
      const beatBest = challenge.personalBest === undefined || scoreResult.total > challenge.personalBest;

      const updated: Challenge = {
        ...challenge,
        attempts: challenge.attempts + 1,
        personalBest: beatBest ? scoreResult.total : challenge.personalBest,
        updatedAt: Date.now(),
      };
      updateChallenge(updated);
      setChallenge(updated);
      setResult(scoreResult);
      setIsNewBest(beatBest);
      trackEvent("game_completed", { gameType: "customChallenge", category: "custom", contentKey: challenge.id });
      setPhase("result");
    }, delay);
  }

  function handleRetry() {
    setAttemptPath(null);
    setResult(null);
    setIsNewBest(false);
    setPreviousBest(undefined);
    setShareFeedback(null);
    setPhase("drawing");
  }

  async function handleShareResult() {
    if (!result || !attemptPath || !challenge) return;
    const resultArgs = {
      challengeId: challenge.id,
      challengeName: challenge.name,
      score: result,
      target: challenge.target,
      attempt: attemptPath,
    };
    const url = (await createShortResultLink(resultArgs)) ?? encodeResultLink(resultArgs);
    const outcome = await shareOrCopy({
      title: `CYDI Result: ${challenge.name}`,
      text: `I scored ${result.total}% on "${challenge.name}"! Think you can beat it?`,
      url,
    });
    if (outcome === "shared" || outcome === "copied") {
      trackEvent("result_shared", { gameType: "customChallenge", category: "custom", contentKey: challenge.id });
    }
    if (outcome === "copied") {
      setShareFeedback("Link copied!");
      window.setTimeout(() => setShareFeedback(null), 2500);
    } else if (outcome === "failed") {
      setShareFeedback(`Couldn't share automatically - copy this link: ${url}`);
    }
  }

  if (!challenge) {
    return (
      <div className="screen">
        <AppHeader
          title="Challenge not found"
          onBack={() => onNavigate(backTarget)}
          onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId, from)))}
          onNavigateToInstructions={() => onNavigate(toInstructions(toPlay(challengeId, from)))}
          onNavigateToShop={() => onNavigate(toShop(toPlay(challengeId, from)))}
          onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
          onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
          onNavigateToHome={() => onNavigate(toHome())}
          onNavigateToSettings={() => onNavigate(toSettings())}
        />
        <Button onClick={() => onNavigate(backTarget)}>{from ? "Back" : "Back to My Challenges"}</Button>
      </div>
    );
  }

  if (phase === "result" && result && attemptPath) {
    return (
      <ResultScreen
        score={result}
        isNewBest={isNewBest}
        previousBest={previousBest}
        bestScore={challenge.personalBest}
        target={challenge.target}
        attempt={attemptPath}
        attemptColor={penColor}
        onRetry={handleRetry}
        onBack={() => onNavigate(backTarget)}
        onShareResult={handleShareResult}
        shareFeedback={shareFeedback}
        onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId, from)))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toPlay(challengeId, from)))}
        onNavigateToShop={() => onNavigate(toShop(toPlay(challengeId, from)))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
        onNavigateToCreate={() => onNavigate(toCreate())}
      />
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title={challenge.name}
        onBack={() => onNavigate(backTarget)}
        onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId, from)))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toPlay(challengeId, from)))}
        onNavigateToShop={() => onNavigate(toShop(toPlay(challengeId, from)))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      {isCoachedFirstVisit ? (
        /* Same inline, non-blocking coach Shape Challenge's first round uses - it is the
           only place "Tap Done" is ever taught, and this screen has no Next Shape. */
        <p className={`status-text canvas-instruction-text${phase !== "analyzing" ? " coach-hint" : ""}`}>
          {phase === "preview" && "👀 Look at the shape"}
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
      <div className="canvas-wrapper">
        <DrawingCanvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          disabled={phase !== "drawing"}
          ghostPath={phase === "preview" ? challenge.target : undefined}
          showGhost={phase === "preview"}
          ghostSolid={solidTargetInPreview(phase === "preview")}
          strokeColor={penColor}
          penSkin={penSkin}
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <>
          <div className="pen-tools-row">
            <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={handleLockedColorClick} />
            <PenSkinMenu
              selected={penSkin}
              inkColor={penInkGlyphColor(penColor)}
              onSelect={handleSelectPenSkin}
              onLockedSkinClick={handleLockedSkinClick}
            />
          </div>
          <div className="button-row">
            <Button variant="secondary" onClick={handleUndo} disabled={!hasStroke}>
              Undo
            </Button>
            <Button onClick={handleDone} className={isCoachedFirstVisit && hasStroke ? "coach-pulse" : undefined}>
              Done
            </Button>
          </div>
        </>
      )}
      {showDrawingTutorial && <DrawingTutorialOverlay onDismiss={dismissDrawingTutorial} />}
    </div>
  );
}
