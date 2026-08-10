import type { DailyLeaderboardEntry } from "../services/dailyChallengeApi";

type DailyLeaderboardTableProps = {
  entries: DailyLeaderboardEntry[];
};

export default function DailyLeaderboardTable({ entries }: DailyLeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <div className="card daily-leaderboard-card">
        <h3 className="daily-leaderboard-title">Top 10</h3>
        <p className="status-text">No scores yet - be the first!</p>
      </div>
    );
  }

  return (
    <div className="card daily-leaderboard-card">
      <h3 className="daily-leaderboard-title">Top 10</h3>
      <table className="daily-leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={index} className={entry.isYou ? "daily-leaderboard-row-self" : undefined}>
              <td>{index + 1}</td>
              <td>
                {entry.playerName}
                {entry.isYou && " (You)"}
              </td>
              <td>{entry.score}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
