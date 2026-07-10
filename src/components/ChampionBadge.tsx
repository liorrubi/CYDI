import { useEffect, useState } from "react";
import { CHAMPION_TITLE } from "../app/constants";
import { isChallengeChampion } from "../services/megaChallengeStore";
import { onSaveDataChanged } from "../services/saveStore";

/**
 * Permanent status crown for players who completed the full Mega Album.
 * Lives in the AppHeader's action row, so it shows on every screen of the
 * game. Renders nothing until the title is earned.
 */
export default function ChampionBadge() {
  const [isChampion, setIsChampion] = useState(() => isChallengeChampion());

  useEffect(() => onSaveDataChanged(() => setIsChampion(isChallengeChampion())), []);

  if (!isChampion) return null;

  return (
    <span className="champion-badge" role="img" aria-label={CHAMPION_TITLE} title={CHAMPION_TITLE}>
      👑
    </span>
  );
}
