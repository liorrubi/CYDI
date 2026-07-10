import { useEffect, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import ResultScreen from "./ResultScreen";
import { ANALYZING_MAX_MS, ANALYZING_MIN_MS, CANVAS_SIZE, PREVIEW_DURATION_MS, type PenColorId } from "../app/constants";
import { getChallenge, updateChallenge } from "../services/challengeStorage";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { encodeResultLink } from "../services/shareLink";
import { createShortResultLink } from "../services/shareApi";
import { shareOrCopy } from "../services/nativeShare";
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
  onNavigate: (screen: Screen) => void;
};

export default function PlayChallengeScreen({ challengeId, onNavigate }: PlayChallengeScreenProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(() => getChallenge(challengeId));
  const [phase, setPhase] = useState<Phase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [previousBest, setPreviousBest] = useState<number | undefined>(undefined);
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleLockedColorClick(id: PenColorId) {
    onNavigate(toShop(toPlay(challengeId), id));
  }

  function handleUndo() {
    canvasRef.current?.undoLastStroke();
  }

  useEffect(() => {
    if (!challenge || phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [challenge, phase]);

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
          onBack={() => onNavigate(toList())}
          onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId)))}
          onNavigateToInstructions={() => onNavigate(toInstructions(toPlay(challengeId)))}
          onNavigateToShop={() => onNavigate(toShop(toPlay(challengeId)))}
          onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
          onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
          onNavigateToHome={() => onNavigate(toHome())}
          onNavigateToSettings={() => onNavigate(toSettings())}
        />
        <Button onClick={() => onNavigate(toList())}>Back to My Challenges</Button>
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
        onBack={() => onNavigate(toList())}
        onShareResult={handleShareResult}
        shareFeedback={shareFeedback}
        onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId)))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toPlay(challengeId)))}
        onNavigateToShop={() => onNavigate(toShop(toPlay(challengeId)))}
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
        onBack={() => onNavigate(toList())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId)))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toPlay(challengeId)))}
        onNavigateToShop={() => onNavigate(toShop(toPlay(challengeId)))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      <p className="status-text canvas-instruction-text">
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
          ghostPath={phase === "preview" ? challenge.target : undefined}
          showGhost={phase === "preview"}
          strokeColor={penColor}
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <>
          <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={handleLockedColorClick} />
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
