import { useState } from "react";
import type { Challenge } from "../types/Challenge";
import Button from "./Button";
import StarRating from "./StarRating";

type ChallengeCardProps = {
  challenge: Challenge;
  onPlay: () => void;
  onShare: () => void;
  onDelete: () => void;
};

export default function ChallengeCard({ challenge, onPlay, onShare, onDelete }: ChallengeCardProps) {
  const created = new Date(challenge.createdAt).toLocaleDateString();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="card challenge-card">
      <div className="challenge-card-info">
        <h3>{challenge.name}</h3>
        <p className="challenge-card-meta">
          Created {created} · {challenge.attempts} {challenge.attempts === 1 ? "attempt" : "attempts"}
        </p>
        <p className="challenge-card-best">
          Best: {challenge.personalBest ?? "—"}
          {challenge.personalBest !== undefined && <StarRating score={challenge.personalBest} />}
        </p>
      </div>
      {confirmingDelete ? (
        <div className="challenge-card-confirm">
          <p>Delete "{challenge.name}"? This can't be undone.</p>
          <div className="challenge-card-actions">
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onDelete}>
              Yes, Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="challenge-card-actions">
          <Button onClick={onPlay}>Play</Button>
          <Button variant="secondary" onClick={onShare}>
            Share
          </Button>
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
