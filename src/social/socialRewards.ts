/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Social Points: what a finished match is worth, and to whom.
//
// Pure arithmetic only - no storage, no React, no snapshot types. The store
// decides whether an award has already been paid; this module decides what the
// award IS, which is the part that has to be provably fair.
//
// SOCIAL POINTS ARE NOT A CURRENCY. They are prestige: earned by playing with
// other people, never spent, never bought, never granted by an ad, and entirely
// separate from CYDI Coins. Nothing in this module or the store subtracts.

/** 🎖️ deliberately, not 👑 - the crown already means something else in CYDI (the daily champion). */
export const SOCIAL_POINTS_ICON = "🎖️";
export const SOCIAL_POINTS_LABEL = "Social Points";

/** Everyone who finishes a live match gets this, winner or not. Turning up and playing it out is the point. */
export const MATCH_COMPLETION_POINTS = 1;

/** Added on top of the completion point, by finishing place: 1st +2, 2nd +1, everyone else +0 - so 3 / 2 / 1. */
export const PLACE_BONUS: readonly number[] = [2, 1];

/**
 * A finished Pass & Play match, paid once to the device.
 *
 * Flat, and NOT split by who won, because both names in that mode are throwaway
 * labels typed into the same phone. Rewarding the winner's name would be
 * rewarding a string, and rewarding the device twice would make "hand it to
 * yourself and rush five rounds" the fastest way to farm points.
 */
export const PASS_PLAY_MATCH_POINTS = 2;

export type RankedEntry = { id: string; totalScore: number };

/**
 * Standard competition ranking - the "1224" convention.
 *
 * Equal totals share the better place, and the places they consume are skipped:
 * two players tied at the top are both 1st, and the next player is 3rd rather
 * than 2nd.
 *
 * This is the tie rule for rewards, and it is deliberately a function of the
 * SCORES ALONE. Nothing here looks at who submitted first, who joined first, or
 * what any latency was: in a live room the fastest connection would win ties,
 * and in Pass & Play the player who took the first turn always submits first,
 * so either would hand out points for something other than drawing. Two players
 * who genuinely tie at the top therefore both collect the winner's +2; nobody
 * collects the +1 for second, because nobody finished second.
 */
export function competitionRanks(entries: readonly RankedEntry[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.totalScore - a.totalScore);
  const ranks = new Map<string, number>();

  let place = 0;
  let previousScore: number | null = null;
  let previousPlace = 0;

  for (const entry of sorted) {
    place += 1;
    const rank = previousScore !== null && entry.totalScore === previousScore ? previousPlace : place;
    ranks.set(entry.id, rank);
    previousScore = entry.totalScore;
    previousPlace = rank;
  }
  return ranks;
}

/** What each player earns for finishing a live match: 3 for first, 2 for second, 1 for everyone else. */
export function multiplayerAwards(entries: readonly RankedEntry[]): Map<string, number> {
  const ranks = competitionRanks(entries);
  const awards = new Map<string, number>();
  for (const [id, rank] of ranks) {
    awards.set(id, MATCH_COMPLETION_POINTS + (PLACE_BONUS[rank - 1] ?? 0));
  }
  return awards;
}

/**
 * The idempotency key for one finished live match.
 *
 * `gameSerial` is issued by the room's Durable Object and bumped once per
 * Start, so it survives a reconnect, a remount and every repeat of the final
 * snapshot - while a rematch, which is a genuinely new match, gets a new one.
 */
export function multiplayerAwardId(roomCode: string, gameSerial: number, seatId: string): string {
  return `mp:${roomCode}:${gameSerial}:${seatId}`;
}

/** The idempotency key for one finished Pass & Play match. The game id is minted when the game is created, so a rematch earns again. */
export function passPlayAwardId(gameId: string): string {
  return `pp:${gameId}`;
}
