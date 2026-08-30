import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ChallengeCard from "../components/ChallengeCard";
import EmptyState from "../components/EmptyState";
import { deleteChallenge, getChallenges } from "../services/challengeStorage";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { shareChallenge, SHARE_FEEDBACK_MS } from "../services/challengeShare";
import { markMyChallengesTutorialShown, shouldShowMyChallengesTutorial } from "../services/tutorialStore";
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
import type { Challenge } from "../types/Challenge";

type MyChallengesScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function MyChallengesScreen({ onNavigate }: MyChallengesScreenProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(() => shouldShowMyChallengesTutorial());
  const tutorialDialogRef = useDialogA11y<HTMLDivElement>(showTutorial, { onClose: handleDismissTutorial });

  useEffect(() => {
    setChallenges(getChallenges());
  }, []);

  function handleDismissTutorial() {
    markMyChallengesTutorialShown();
    setShowTutorial(false);
  }

  function handleDelete(id: string) {
    deleteChallenge(id);
    setChallenges(getChallenges());
  }

  /*
   * The flow itself now lives in services/challengeShare.ts so the Game Hub can
   * run the SAME share rather than a second copy of it. This screen still owns
   * how the outcome is shown, which is the only part that was ever specific to
   * it - including the failure message staying up, because it carries the link.
   */
  async function handleShare(challenge: Challenge) {
    const result = await shareChallenge(challenge);
    if (!result.message) return;
    setShareFeedback(result.message);
    if (!result.sticky) window.setTimeout(() => setShareFeedback(null), SHARE_FEEDBACK_MS);
  }

  return (
    <div className="screen">
      <AppHeader
        title="My Challenges"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toList()))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toList()))}
        onNavigateToShop={() => onNavigate(toShop(toList()))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      {showTutorial && (
        <div className="myc-tutorial-overlay" onClick={handleDismissTutorial}>
          <div
            ref={tutorialDialogRef}
            className="password-prompt-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-challenges-tutorial-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="my-challenges-tutorial-title">My Challenges</h2>
            <p className="status-text">Choose how you want to play:</p>
            <ol className="instructions-tip-list">
              <li>Tap Play to challenge a friend on this device.</li>
              <li>Tap Share to send the challenge to a friend on their own device.</li>
            </ol>
            <Button onClick={handleDismissTutorial}>Got it</Button>
          </div>
        </div>
      )}
      {shareFeedback && <p className="status-text">{shareFeedback}</p>}
      {challenges.length === 0 ? (
        <EmptyState message="No challenges yet" actionLabel="Create one" onAction={() => onNavigate(toCreate())} />
      ) : (
        <div className="challenge-list">
          {challenges.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              onPlay={() => onNavigate(toPlay(challenge.id))}
              onShare={() => handleShare(challenge)}
              onDelete={() => handleDelete(challenge.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
