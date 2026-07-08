import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import ChallengeCard from "../components/ChallengeCard";
import EmptyState from "../components/EmptyState";
import { deleteChallenge, getChallenges } from "../services/challengeStorage";
import { encodeChallengeLink } from "../services/shareLink";
import { createShortChallengeLink } from "../services/shareApi";
import { shareOrCopy } from "../services/nativeShare";
import { toAchievements, toCreate, toHome, toInstructions, toList, toPlay, toSettings, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { Challenge } from "../types/Challenge";

type MyChallengesScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function MyChallengesScreen({ onNavigate }: MyChallengesScreenProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    setChallenges(getChallenges());
  }, []);

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
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
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
