const REQUEST_TIMEOUT_MS = 4000;

/** One row of the Top 10 board. There's no separate "winner" field anywhere - the winner of an episode is always entries[0]. */
export type DailyLeaderboardEntry = { playerId: string; playerName: string; score: number; achievedAt: number };

export type DailyEpisode = {
  id: number;
  shapeId: string;
  dateKey: string;
  startedAt: number;
  status: "active" | "ended";
  topEntries: DailyLeaderboardEntry[];
  yourBest: number | null;
};

/** History list entries carry only the top 3 (the prize winners) - the full Top 10 is fetched per-episode via fetchDailyEpisode. */
export type DailyHistoryEntry = { id: number; shapeId: string; dateKey: string; topEntries: DailyLeaderboardEntry[] };

export type DailySubmitResult = {
  yourBest: number;
  youWon: boolean;
  episodeId: number;
  current: DailyEpisode;
};

/** A 1st/2nd/3rd place prize handed over by claimDailyPrizes - it was queued when its episode ended and is removed from the queue in the same call, so it's only ever returned once. */
export type DailyClaimedPrize = { episodeId: number; dateKey: string; place: 1 | 2 | 3; coins: number; playerName: string };

// Same fail-closed pattern as shareApi.ts: any network/server problem resolves
// to null so callers can show a friendly "offline" state instead of throwing.
async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(path, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function fetchCurrentDailyEpisode(playerId: string): Promise<DailyEpisode | null> {
  return request<DailyEpisode>(`/api/daily/current?playerId=${encodeURIComponent(playerId)}`);
}

export function fetchDailyEpisode(episodeId: number, playerId: string): Promise<DailyEpisode | null> {
  return request<DailyEpisode>(`/api/daily/episode/${episodeId}?playerId=${encodeURIComponent(playerId)}`);
}

export function fetchDailyHistory(limit = 30): Promise<{ episodes: DailyHistoryEntry[] } | null> {
  return request<{ episodes: DailyHistoryEntry[] }>(`/api/daily/history?limit=${limit}`);
}

export function submitDailyScore(args: {
  playerId: string;
  playerName: string;
  episodeId: number;
  score: number;
}): Promise<DailySubmitResult | null> {
  return request<DailySubmitResult>("/api/daily/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
}

/** Hands over (and permanently clears) every prize this player has queued - safe to call speculatively any time, e.g. on every app open. */
export function claimDailyPrizes(playerId: string): Promise<{ claimed: DailyClaimedPrize[] } | null> {
  return request<{ claimed: DailyClaimedPrize[] }>("/api/daily/claim-prizes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
}
