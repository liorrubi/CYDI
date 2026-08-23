/**
 * The shape of a row, rather than PublicPlayer itself.
 *
 * Pass & Play has no seats, no host and no connection state, but the standings
 * it needs are this table down to the accuracy/speed breakdown. Typing the row
 * structurally lets both modes share one component: PublicPlayer satisfies it
 * unchanged, and the two live-room fields are optional.
 */
export type LeaderboardPlayer = {
  /** Any stable per-player key - a seat id in Play Together, a local player id in Pass & Play. */
  seatId: string;
  nickname: string;
  totalScore: number;
  roundScore: number | null;
  roundAccuracy: number | null;
  roundSpeed: number | null;
  isHost?: boolean;
  /** Omitted means present. Only a live room can have someone away. */
  connected?: boolean;
};

type MultiplayerLeaderboardProps = {
  players: readonly LeaderboardPlayer[];
  /** The row to tag as "You", or null when everyone is sitting around the same device. */
  yourSeatId: string | null;
  /** Highlighted as the winner - the round winner(s) or the champion(s). More than one id is a tie. */
  highlightSeatIds?: readonly string[] | null;
  /** Shows the "This round" column. Off for the final standings, where only the total matters. */
  showRoundScore?: boolean;
};

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * The standings table.
 *
 * `players` arrives already sorted by total score (the server sorts it, and the
 * fake harness matches), so position here is presentation only - the component
 * never re-ranks and can never disagree with what the server decided.
 */
export default function MultiplayerLeaderboard({
  players,
  yourSeatId,
  highlightSeatIds,
  showRoundScore = true,
}: MultiplayerLeaderboardProps) {
  const winners = highlightSeatIds ?? [];
  return (
    <table className="mp-leaderboard">
      <caption className="sr-only">Scores</caption>
      <thead>
        <tr>
          <th scope="col" className="mp-lb-rank">
            #
          </th>
          <th scope="col" className="mp-lb-name">
            Player
          </th>
          {showRoundScore && (
            <th scope="col" className="mp-lb-num">
              Round
            </th>
          )}
          <th scope="col" className="mp-lb-num">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {players.map((player, index) => {
          const isYou = player.seatId === yourSeatId;
          const classes = ["mp-lb-row", isYou ? "mp-lb-row-you" : "", winners.includes(player.seatId) ? "mp-lb-row-win" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <tr key={player.seatId} className={classes}>
              <td className="mp-lb-rank">{MEDALS[index] ?? index + 1}</td>
              <td className="mp-lb-name">
                <span className="mp-lb-nickname">{player.nickname}</span>
                {isYou && <span className="mp-lb-tag">You</span>}
                {player.isHost && <span className="mp-lb-tag mp-lb-tag-host">Host</span>}
                {player.connected === false && (
                  <span className="mp-lb-tag mp-lb-tag-away" title="Disconnected">
                    Away
                  </span>
                )}
              </td>
              {showRoundScore && (
                <td className="mp-lb-num">
                  {player.roundScore === null ? (
                    <span className="mp-lb-muted" title="Did not submit in time">
                      —
                    </span>
                  ) : (
                    <>
                      <span className="mp-lb-round-score">+{player.roundScore}</span>
                      {player.roundAccuracy !== null && (
                        // The breakdown is what makes "why did they beat me"
                        // answerable, and it teaches the 75/25 split without a
                        // separate explainer.
                        <span className="mp-lb-breakdown">
                          {player.roundAccuracy}% acc · {player.roundSpeed} spd
                        </span>
                      )}
                    </>
                  )}
                </td>
              )}
              <td className="mp-lb-num mp-lb-total">{player.totalScore}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
