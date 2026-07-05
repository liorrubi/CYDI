import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DrawingCanvas from "../components/DrawingCanvas";
import ScoreCard from "../components/ScoreCard";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import {
  ANALYZING_MAX_MS,
  ANALYZING_MIN_MS,
  CANVAS_SIZE,
  PREVIEW_DURATION_MS,
  SHAPE_CHALLENGE_PASS_SCORE,
} from "../app/constants";
import { SHAPE_LIBRARY } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import { getProgress, saveProgress, type ShapeChallengeProgress } from "../services/shapeChallengeProgress";
import { toHome } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

type Phase = "preview" | "drawing" | "analyzing" | "result";

type ShapeChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function ShapeChallengeScreen({ onNavigate }: ShapeChallengeScreenProps) {
  const [progress, setProgress] = useState<ShapeChallengeProgress>(() => {
    const stored = getProgress();
    return { ...stored, levelIndex: Math.min(stored.levelIndex, SHAPE_LIBRARY.length) };
  });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (selectedIndex === null) {
    return <ShapeMap progress={progress} onSelect={setSelectedIndex} onBack={() => onNavigate(toHome())} />;
  }

  return (
    <ShapePlay
      levelIndex={selectedIndex}
      progress={progress}
      onProgressChange={setProgress}
      onNextShape={setSelectedIndex}
      onBackToMap={() => setSelectedIndex(null)}
    />
  );
}

type ShapeMapProps = {
  progress: ShapeChallengeProgress;
  onSelect: (index: number) => void;
  onBack: () => void;
};

function ShapeMap({ progress, onSelect, onBack }: ShapeMapProps) {
  const allComplete = progress.levelIndex >= SHAPE_LIBRARY.length;
  const subtitle = allComplete
    ? "All shapes complete!"
    : `${progress.levelIndex} of ${SHAPE_LIBRARY.length} unlocked`;

  return (
    <div className="screen">
      <AppHeader title="Shape Challenge" subtitle={subtitle} onBack={onBack} />
      <div className="shape-grid">
        {SHAPE_LIBRARY.map((shape, index) => {
          const unlocked = index <= progress.levelIndex;
          const completed = index < progress.levelIndex;
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
            <button key={shape.id} type="button" className="shape-tile" onClick={() => onSelect(index)}>
              <ShapePreviewIcon shape={shape} />
              {completed && best !== undefined && <span className="shape-tile-best">{best}</span>}
              <p className="shape-tile-name">{shape.name}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ShapePlayProps = {
  levelIndex: number;
  progress: ShapeChallengeProgress;
  onProgressChange: (progress: ShapeChallengeProgress) => void;
  onNextShape: (index: number) => void;
  onBackToMap: () => void;
};

function ShapePlay({ levelIndex, progress, onProgressChange, onNextShape, onBackToMap }: ShapePlayProps) {
  const shape = SHAPE_LIBRARY[levelIndex];
  const target = useMemo(() => shape.generate(CANVAS_SIZE), [shape]);
  const bestScore = progress.bestScores[shape.id];

  const [phase, setPhase] = useState<Phase>("preview");
  const [attemptPath, setAttemptPath] = useState<DrawingPath | null>(null);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);

  useEffect(() => {
    if (phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  function handleDone() {
    if (!attemptPath) return;
    setPhase("analyzing");

    const delay = ANALYZING_MIN_MS + Math.random() * (ANALYZING_MAX_MS - ANALYZING_MIN_MS);
    window.setTimeout(() => {
      const scoreResult = scoreAttempt(target, attemptPath);
      const beatBest = bestScore === undefined || scoreResult.total > bestScore;
      const passedNow = scoreResult.total >= SHAPE_CHALLENGE_PASS_SCORE;
      const advancesFrontier = passedNow && levelIndex === progress.levelIndex;

      const updatedProgress: ShapeChallengeProgress = {
        levelIndex: advancesFrontier ? progress.levelIndex + 1 : progress.levelIndex,
        bestScores: { ...progress.bestScores, [shape.id]: beatBest ? scoreResult.total : bestScore! },
      };
      saveProgress(updatedProgress);
      onProgressChange(updatedProgress);

      setResult(scoreResult);
      setIsNewBest(beatBest);
      setPhase("result");
    }, delay);
  }

  function handleTryAgain() {
    setAttemptPath(null);
    setResult(null);
    setIsNewBest(false);
    setPhase("preview");
  }

  const passed = result !== null && result.total >= SHAPE_CHALLENGE_PASS_SCORE;
  const nextIndex = levelIndex + 1;
  const justUnlockedNext = passed && nextIndex === progress.levelIndex && nextIndex < SHAPE_LIBRARY.length;
  const bestLabel = bestScore === undefined ? "—" : String(bestScore);

  if (phase === "result" && result) {
    return (
      <div className="screen">
        <ScoreCard score={result} isNewBest={isNewBest} />
        <div className="button-row">
          <Button variant="secondary" onClick={handleTryAgain}>
            Try Again
          </Button>
          {justUnlockedNext && <Button onClick={() => onNextShape(nextIndex)}>Next Shape</Button>}
        </div>
        {!passed && (
          <p className="form-error">Score {SHAPE_CHALLENGE_PASS_SCORE}+ to unlock the next shape.</p>
        )}
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
        subtitle={`Best: ${bestLabel} · Pass score: ${SHAPE_CHALLENGE_PASS_SCORE}+`}
        onBack={onBackToMap}
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
