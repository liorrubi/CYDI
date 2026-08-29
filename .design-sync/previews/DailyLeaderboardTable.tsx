import { DailyLeaderboardTable } from "cydi";

const day = Date.UTC(2026, 7, 28);

const ENTRIES = [
  { playerName: "Maya", score: 98, achievedAt: day + 3_600_000, isYou: false },
  { playerName: "Ori", score: 95, achievedAt: day + 7_200_000, isYou: false },
  { playerName: "Dana", score: 91, achievedAt: day + 9_000_000, isYou: true },
  { playerName: "Tal", score: 88, achievedAt: day + 10_800_000, isYou: false },
  { playerName: "Noa", score: 84, achievedAt: day + 12_600_000, isYou: false },
  { playerName: "Amit", score: 79, achievedAt: day + 14_400_000, isYou: false },
];

/** Today's top ten, with the player's own row highlighted. */
export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <DailyLeaderboardTable entries={ENTRIES} />
  </div>
);

/** Before anyone has played, the table collapses to a prompt. */
export const Empty = () => (
  <div style={{ maxWidth: 420 }}>
    <DailyLeaderboardTable entries={[]} />
  </div>
);
