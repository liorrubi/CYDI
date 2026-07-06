import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import ChallengeCard from "../components/ChallengeCard";
import EmptyState from "../components/EmptyState";
import { deleteChallenge, getChallenges } from "../services/challengeStorage";
import { toAchievements, toCreate, toHome, toInstructions, toList, toPlay } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { Challenge } from "../types/Challenge";

type MyChallengesScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function MyChallengesScreen({ onNavigate }: MyChallengesScreenProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);

  useEffect(() => {
    setChallenges(getChallenges());
  }, []);

  function handleDelete(id: string) {
    deleteChallenge(id);
    setChallenges(getChallenges());
  }

  return (
    <div className="screen">
      <AppHeader
        title="My Challenges"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toList()))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toList()))}
      />
      {challenges.length === 0 ? (
        <EmptyState message="No challenges yet" actionLabel="Create one" onAction={() => onNavigate(toCreate())} />
      ) : (
        <div className="challenge-list">
          {challenges.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              onPlay={() => onNavigate(toPlay(challenge.id))}
              onDelete={() => handleDelete(challenge.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
