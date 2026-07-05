import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DrawingCanvas from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import ResultScreen from "./ResultScreen";
import { ANALYZING_MAX_MS, ANALYZING_MIN_MS, CANVAS_SIZE, PREVIEW_DURATION_MS, type PenColorId } from "../app/constants";
import { getChallenge, updateChallenge } from "../services/challengeStorage";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { scoreAttempt } from "../engine/scoring";
import { toAchievements, toList, toPlay, toShop } from "../app/routes";
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
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleLockedColorClick() {
    onNavigate(toShop(toPlay(challengeId)));
  }

  useEffect(() => {
    if (!challenge || phase !== "preview") return;
    const timeoutId = window.setTimeout(() => setPhase("drawing"), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [challenge, phase]);

  function handleDone() {
    if (!attemptPath || !challenge) return;
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
    setPhase("drawing");
  }

  if (!challenge) {
    return (
      <div className="screen">
        <AppHeader
          title="Challenge not found"
          onBack={() => onNavigate(toList())}
          onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId)))}
        />
        <Button onClick={() => onNavigate(toList())}>Back to My Challenges</Button>
      </div>
    );
  }

  if (phase === "result" && result) {
    return (
      <ResultScreen
        score={result}
        isNewBest={isNewBest}
        onRetry={handleRetry}
        onBack={() => onNavigate(toList())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId)))}
      />
    );
  }

  return (
    <div className="screen">
      <AppHeader
        title={challenge.name}
        onBack={() => onNavigate(toList())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toPlay(challengeId)))}
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
            <Button onClick={handleDone}>Done</Button>
          </div>
        </>
      )}
    </div>
  );
}
