import Button from "../components/Button";
import { toHome, toPlay } from "../app/routes";
import type { Screen } from "../types/GameMode";

type FriendChallengeIntroScreenProps = {
  challengeId: string;
  onNavigate: (screen: Screen) => void;
};

/** Landing screen shown every time a player opens a challenge link a friend sent them - explains the invite, then either starts the challenge or lets them explore the rest of CYDI first. */
export default function FriendChallengeIntroScreen({ challengeId, onNavigate }: FriendChallengeIntroScreenProps) {
  function handleStart() {
    onNavigate(toPlay(challengeId));
  }

  function handleExplore() {
    onNavigate(toHome());
  }

  return (
    <div className="screen">
      <div className="card friend-challenge-intro-card">
        <h1>You were challenged!</h1>
        <p>Your friend created a drawing challenge for you. Try to copy the drawing as accurately as possible and beat their score.</p>
        <p className="status-text">Complete the challenge — then discover more ways to play, earn coins and unlock rewards.</p>
      </div>
      <div className="button-row">
        <Button variant="secondary" onClick={handleExplore}>
          Explore CYDI
        </Button>
        <Button onClick={handleStart}>Start Challenge</Button>
      </div>
    </div>
  );
}
