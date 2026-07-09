import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import StarRating from "../components/StarRating";
import { DAILY_CHALLENGE_PRIZE_COINS } from "../app/dailyChallengePrizes";
import { getShapeById } from "../engine/shapeLibrary";
import { fetchDailyEpisode, fetchDailyHistory, type DailyHistoryEntry } from "../services/dailyChallengeApi";
import { getPlayerId } from "../services/playerProfileStore";
import {
  toAchievements,
  toDailyChallenge,
  toDailyChallengeHistory,
  toDailyChallengeReplay,
  toHome,
  toInstructions,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import type { Screen } from "../types/GameMode";

type LoadState = "loading" | "error" | "ready";

const MEDALS = ["🥇", "🥈", "🥉"];

type DailyChallengeHistoryScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function DailyChallengeHistoryScreen({ onNavigate }: DailyChallengeHistoryScreenProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [entries, setEntries] = useState<DailyHistoryEntry[]>([]);
  const [bestByEpisode, setBestByEpisode] = useState<Record<number, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadState("loading");
      const playerId = getPlayerId();
      const history = await fetchDailyHistory(30);
      if (cancelled) return;
      if (!history) {
        setLoadState("error");
        return;
      }
      setEntries(history.episodes);
      setLoadState("ready");

      // Personal bests are fetched separately (one small DO lookup per episode)
      // so the list itself renders immediately without waiting on all of them.
      const results = await Promise.all(
        history.episodes.map(async (entry) => {
          const detail = await fetchDailyEpisode(entry.id, playerId);
          return [entry.id, detail?.yourBest ?? null] as const;
        }),
      );
      if (cancelled) return;
      setBestByEpisode(Object.fromEntries(results));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen">
      <AppHeader
        title="Previous Challenges"
        onBack={() => onNavigate(toDailyChallenge())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toDailyChallengeHistory()))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toDailyChallengeHistory()))}
        onNavigateToShop={() => onNavigate(toShop(toDailyChallengeHistory()))}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      {loadState === "loading" && <p className="status-text">Loading past challenges...</p>}
      {loadState === "error" && <p className="form-error">Couldn't load past challenges. Check your connection.</p>}
      {loadState === "ready" && entries.length === 0 && <EmptyState message="No past challenges yet" />}
      {loadState === "ready" && entries.length > 0 && (
        <div className="challenge-list">
          {entries.map((entry) => {
            const shape = getShapeById(entry.shapeId);
            const best = bestByEpisode[entry.id];
            return (
              <div key={entry.id} className="card challenge-card">
                <div className="challenge-card-info">
                  {shape && <ShapePreviewIcon shape={shape} />}
                  <h3>{entry.dateKey}</h3>
                  {entry.topEntries.length === 0 ? (
                    <p className="challenge-card-meta">No winner</p>
                  ) : (
                    <ul className="daily-history-prizes">
                      {entry.topEntries.map((winner, index) => (
                        <li key={winner.playerId}>
                          {MEDALS[index]} {winner.playerName} - {winner.score}% (+{DAILY_CHALLENGE_PRIZE_COINS[index]} 🪙)
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="challenge-card-best">
                    Your best: {best === undefined || best === null ? "—" : `${best}%`}
                    {best !== undefined && best !== null && <StarRating score={best} />}
                  </p>
                </div>
                <div className="challenge-card-actions">
                  <Button onClick={() => onNavigate(toDailyChallengeReplay(entry))}>Play Again</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
