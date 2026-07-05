import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DrawingCanvas from "../components/DrawingCanvas";
import ScoreCard from "../components/ScoreCard";
import { ANALYZING_MAX_MS, ANALYZING_MIN_MS, CANVAS_SIZE, PREVIEW_DURATION_MS } from "../app/constants";
import { shapeAtLevel } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import { getProgress, saveProgress } from "../services/shapeChallengeProgress";
import { toHome } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "preview" | "drawing" | "analyzing" | "result";

type ShapeChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function ShapeChallengeScreen({ onNavigate }: ShapeChallengeScreenProps) {
  const [progress, setProgress] = useState(() => getProgress());
  const [phase, setPhase] = useState<Phase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);

  const shape = shapeAtLevel(progress.levelIndex);
  const target = useMemo(() => shape.generate(CANVAS_SIZE), [shape]);
  const bestScore = progress.bestScores[shape.id];

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase, shape]);

  function handleDone() {
    if (!attemptPath) return;
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(target, attemptPath);
      const beatBest = bestScore === undefined || scoreResult.total > bestScore;

      const updatedProgress = {
        ...progress,
        bestScores: { ...progress.bestScores, [shape.id]: beatBest ? scoreResult.total : bestScore! },
      };
      saveProgress(updatedProgress);
      setProgress(updatedProgress);

      setResult(scoreResult);
      setIsNewBest(beatBest);
      setPhase("result");
    }, delay);
  }

  function handleTryAgain() {
    setAttemptPath(null);
    setResult(null);
    setIsNewBest(false);
    setPhase("drawing");
  }

  function handleNextShape() {
    const updatedProgress = { ...progress, levelIndex: progress.levelIndex + 1 };
    saveProgress(updatedProgress);
    setProgress(updatedProgress);
    setAttemptPath(null);
    setResult(null);
    setIsNewBest(false);
    setPhase("preview");
  }

  const levelLabel = `Level ${progress.levelIndex + 1} · ${shape.name}`;
  const bestLabel = bestScore === undefined ? "—" : String(bestScore);

  if (phase === "result" && result) {
    return (
      <div className="screen">
        <ScoreCard score={result} isNewBest={isNewBest} />
        <div className="button-row">
          <Button variant="secondary" onClick={handleTryAgain}>
            Try Again
          </Button>
          <Button onClick={handleNextShape}>Next Shape</Button>
        </div>
        <Button variant="secondary" onClick={() => onNavigate(toHome())}>
          Home
        </Button>
      </div>
    );
  }

  return (
    <div className="screen">
      <AppHeader title={levelLabel} subtitle={`Best: ${bestLabel}`} onBack={() => onNavigate(toHome())} />
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
          ghostPath={phase === "preview" ? target : undefined}
          showGhost={phase === "preview"}
          onChange={setAttemptPath}
          onComplete={setAttemptPath}
        />
      </div>
      {phase === "drawing" && (
        <div className="button-row">
          <Button onClick={handleDone}>Done</Button>
        </div>
      )}
    </div>
  );
}
