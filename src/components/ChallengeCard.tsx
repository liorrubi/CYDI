import type { Challenge } from "../types/Challenge";
import Button from "./Button";

type ChallengeCardProps = {
  challenge: Challenge;
  onPlay: () => void;
  onDelete: () => void;
};

export default function ChallengeCard({ challenge, onPlay, onDelete }: ChallengeCardProps) {
  const created = new Date(challenge.createdAt).toLocaleDateString();

  return (
    <div className="card challenge-card">
      <div className="challenge-card-info">
        <h3>{challenge.name}</h3>
        <p className="challenge-card-meta">
          Created {created} · {challenge.attempts} {challenge.attempts === 1 ? "attempt" : "attempts"}
        </p>
        <p className="challenge-card-best">Best: {challenge.personalBest ?? "—"}</p>
      </div>
      <div className="challenge-card-actions">
        <Button onClick={onPlay}>Play</Button>
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
