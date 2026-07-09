import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ChallengeCard from "../components/ChallengeCard";
import EmptyState from "../components/EmptyState";
import { deleteChallenge, getChallenges } from "../services/challengeStorage";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { encodeChallengeLink } from "../services/shareLink";
import { createShortChallengeLink } from "../services/shareApi";
import { shareOrCopy } from "../services/nativeShare";
import { recordChallengeShared } from "../services/sharedChallengesStore";
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

  async function handleShare(challenge: Challenge) {
    const url = (await createShortChallengeLink(challenge)) ?? encodeChallengeLink(challenge);
    const outcome = await shareOrCopy({
      title: `CYDI Challenge: ${challenge.name}`,
      text: `Can you draw "${challenge.name}"? Try my CYDI challenge!`,
      url,
    });
    // Only "shared"/"copied" mean the link actually left the device - "cancelled"
    // (backed out of the share sheet) and "failed" never reached a friend, so
    // they shouldn't count toward the sharing achievements.
    if (outcome === "shared" || outcome === "copied") recordChallengeShared(challenge.id);
    if (outcome === "copied") {
      setShareFeedback("Link copied!");
      window.setTimeout(() => setShareFeedback(null), 2500);
    } else if (outcome === "failed") {
      setShareFeedback(`Couldn't share automatically - copy this link: ${url}`);
    }
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
