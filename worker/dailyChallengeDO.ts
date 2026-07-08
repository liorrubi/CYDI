import { DAILY_CHALLENGE_PRIZE_COINS } from "../src/app/dailyChallengePrizes";
import { SHAPE_LIBRARY } from "../src/engine/shapeLibrary";

// Single global Durable Object instance coordinates the daily challenge, so every
// request (rollover check, score submission, "first to 100" arbitration) is
// processed one at a time - no read-modify-write races between players.

const WIN_SCORE = 100;
const MAX_HISTORY = 100;
const MAX_NAME_LENGTH = 24;
const TOP_ENTRIES_LIMIT = 10;

type LeaderboardEntry = { playerId: string; playerName: string; score: number; achievedAt: number };

type Episode = {
  id: number;
  shapeId: string;
  dateKey: string; // "YYYY-MM-DD" in Asia/Jerusalem
  startedAt: number;
  endedAt: number | null;
  status: "active" | "ended";
  /** Best score per player, sorted score desc then achievedAt asc (earlier reach wins ties), capped to TOP_ENTRIES_LIMIT. The "winner" is always entries[0] - there's no separate field to keep in sync. */
  topEntries: LeaderboardEntry[];
};

/** Replaces this player's existing row (if any) and re-sorts, keeping only the top TOP_ENTRIES_LIMIT. */
function upsertTopEntries(entries: LeaderboardEntry[], entry: LeaderboardEntry): LeaderboardEntry[] {
  const withoutPlayer = entries.filter((e) => e.playerId !== entry.playerId);
  const combined = [...withoutPlayer, entry];
  combined.sort((a, b) => b.score - a.score || a.achievedAt - b.achievedAt);
  return combined.slice(0, TOP_ENTRIES_LIMIT);
}

type BoardEntry = { playerName: string; bestScore: number; updatedAt: number };

/** A 1st/2nd/3rd place prize earned in a specific (now-ended) episode, sitting in a player's queue until they claim it. */
type PendingPrize = { episodeId: number; dateKey: string; place: 1 | 2 | 3; coins: number; playerName: string };

type HistoryEntry = { id: number; shapeId: string; dateKey: string; topEntries: LeaderboardEntry[] };

function israelDateKey(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function randomShapeId(): string {
  return SHAPE_LIBRARY[Math.floor(Math.random() * SHAPE_LIBRARY.length)].id;
}

function sanitizeName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export class DailyChallengeDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private boardKey(episodeId: number, playerId: string): string {
    return `board:${episodeId}:${playerId}`;
  }

  private pendingPrizesKey(playerId: string): string {
    return `pendingPrizes:${playerId}`;
  }

  private async getBoardEntry(episodeId: number, playerId: string): Promise<BoardEntry | null> {
    return (await this.state.storage.get<BoardEntry>(this.boardKey(episodeId, playerId))) ?? null;
  }

  private async nextEpisodeId(): Promise<number> {
    const lastId = (await this.state.storage.get<number>("lastEpisodeId")) ?? 0;
    const nextId = lastId + 1;
    await this.state.storage.put("lastEpisodeId", nextId);
    return nextId;
  }

  private async createEpisode(dateKey: string): Promise<Episode> {
    return {
      id: await this.nextEpisodeId(),
      shapeId: randomShapeId(),
      dateKey,
      startedAt: Date.now(),
      endedAt: null,
      status: "active",
      topEntries: [],
    };
  }

  /**
   * Single choke point for ending an episode: records it in history and queues
   * 1st/2nd/3rd place prizes for their winners. Called exactly once per episode
   * (from the win-by-100 path and the midnight-rollover path), which is what
   * guarantees prizes are ever queued once - never on a replay of an already-
   * ended episode, since nothing else ever calls this.
   */
  private async archiveEpisode(episode: Episode): Promise<void> {
    await this.state.storage.put(`episode:${episode.id}`, episode);

    const history = (await this.state.storage.get<HistoryEntry[]>("historyIndex")) ?? [];
    history.unshift({ id: episode.id, shapeId: episode.shapeId, dateKey: episode.dateKey, topEntries: episode.topEntries.slice(0, 3) });
    await this.state.storage.put("historyIndex", history.slice(0, MAX_HISTORY));

    const winners = episode.topEntries.slice(0, 3);
    for (let place = 0; place < winners.length; place++) {
      const entry = winners[place];
      const key = this.pendingPrizesKey(entry.playerId);
      const pending = (await this.state.storage.get<PendingPrize[]>(key)) ?? [];
      pending.push({
        episodeId: episode.id,
        dateKey: episode.dateKey,
        place: (place + 1) as 1 | 2 | 3,
        coins: DAILY_CHALLENGE_PRIZE_COINS[place],
        playerName: entry.playerName,
      });
      await this.state.storage.put(key, pending);
    }
  }

  /** Loads the active episode, lazily rolling it over to a fresh one if the Israel calendar date has moved on since it started. */
  private async loadCurrent(): Promise<Episode> {
    const nowKey = israelDateKey(Date.now());
    let current = await this.state.storage.get<Episode>("current");
    if (!current) {
      current = await this.createEpisode(nowKey);
      await this.state.storage.put("current", current);
      return current;
    }
    if (current.dateKey !== nowKey) {
      if (current.status === "active") {
        await this.archiveEpisode({ ...current, status: "ended", endedAt: Date.now() });
      }
      current = await this.createEpisode(nowKey);
      await this.state.storage.put("current", current);
    }
    return current;
  }

  private publicEpisode(episode: Episode, yourBest: number | null) {
    return {
      id: episode.id,
      shapeId: episode.shapeId,
      dateKey: episode.dateKey,
      startedAt: episode.startedAt,
      status: episode.status,
      topEntries: episode.topEntries ?? [],
      yourBest,
    };
  }

  private async handleCurrent(playerId: string | null): Promise<Response> {
    const current = await this.loadCurrent();
    const yourBest = playerId ? (await this.getBoardEntry(current.id, playerId))?.bestScore ?? null : null;
    return json(this.publicEpisode(current, yourBest));
  }

  private async handleHistory(limit: number): Promise<Response> {
    // Loading current first applies any pending lazy rollover, so a freshly-ended
    // episode shows up in the history list immediately rather than only after
    // the next unrelated /current request happens to trigger the rollover.
    await this.loadCurrent();
    const history = (await this.state.storage.get<HistoryEntry[]>("historyIndex")) ?? [];
    return json({ episodes: history.slice(0, limit) });
  }

  private async handleEpisode(id: number, playerId: string | null): Promise<Response> {
    const current = await this.loadCurrent();
    const episode = id === current.id ? current : await this.state.storage.get<Episode>(`episode:${id}`);
    if (!episode) return json({ error: "not found" }, 404);
    const yourBest = playerId ? (await this.getBoardEntry(episode.id, playerId))?.bestScore ?? null : null;
    return json(this.publicEpisode(episode, yourBest));
  }

  private async handleSubmit(body: unknown): Promise<Response> {
    const b = body as Record<string, unknown> | null;
    const playerId = typeof b?.playerId === "string" && b.playerId ? b.playerId : null;
    const episodeId = typeof b?.episodeId === "number" ? b.episodeId : null;
    const scoreRaw = typeof b?.score === "number" ? b.score : null;
    if (!playerId || episodeId === null || scoreRaw === null) return json({ error: "invalid payload" }, 400);

    const playerName = sanitizeName(b?.playerName) || "Anonymous Player";
    const score = Math.max(0, Math.min(100, Math.round(scoreRaw)));

    const current = await this.loadCurrent();
    const isCurrentEpisode = episodeId === current.id;
    const targetEpisode = isCurrentEpisode ? current : await this.state.storage.get<Episode>(`episode:${episodeId}`);
    if (!targetEpisode) return json({ error: "episode not found" }, 404);

    const boardKey = this.boardKey(targetEpisode.id, playerId);
    const existingBoard = await this.getBoardEntry(targetEpisode.id, playerId);
    const improved = !existingBoard || score > existingBoard.bestScore;
    const yourBest = improved ? score : existingBoard!.bestScore;
    if (improved) {
      await this.state.storage.put(boardKey, { playerName, bestScore: score, updatedAt: Date.now() } satisfies BoardEntry);
    }

    let youWon = false;

    // Only the live episode's own leaderboard can change - replays of ended
    // episodes only ever update the replaying player's own best above, never
    // the frozen topEntries (and therefore never re-queue a prize) captured
    // at the moment it ended.
    if (isCurrentEpisode && targetEpisode.status === "active" && improved) {
      const achievedAt = Date.now();
      const updatedTopEntries = upsertTopEntries(targetEpisode.topEntries ?? [], { playerId, playerName, score, achievedAt });

      if (score >= WIN_SCORE) {
        const ended: Episode = { ...targetEpisode, status: "ended", endedAt: achievedAt, topEntries: updatedTopEntries };
        await this.archiveEpisode(ended);
        const fresh = await this.createEpisode(ended.dateKey);
        await this.state.storage.put("current", fresh);
        youWon = true;
      } else {
        const updated: Episode = { ...targetEpisode, topEntries: updatedTopEntries };
        await this.state.storage.put("current", updated);
      }
    }

    const freshCurrent = await this.loadCurrent();
    const currentYourBest =
      freshCurrent.id === targetEpisode.id ? yourBest : (await this.getBoardEntry(freshCurrent.id, playerId))?.bestScore ?? null;

    return json({
      yourBest,
      youWon,
      episodeId: targetEpisode.id,
      current: this.publicEpisode(freshCurrent, currentYourBest),
    });
  }

  /** Hands over (and clears) every prize a player has queued - the clear-on-read is what makes claiming exactly-once. */
  private async handleClaimPrizes(body: unknown): Promise<Response> {
    const b = body as Record<string, unknown> | null;
    const playerId = typeof b?.playerId === "string" && b.playerId ? b.playerId : null;
    if (!playerId) return json({ error: "invalid payload" }, 400);

    const key = this.pendingPrizesKey(playerId);
    const pending = (await this.state.storage.get<PendingPrize[]>(key)) ?? [];
    if (pending.length > 0) await this.state.storage.delete(key);
    return json({ claimed: pending });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId");

    if (url.pathname === "/current" && request.method === "GET") return this.handleCurrent(playerId);

    if (url.pathname === "/submit" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      return this.handleSubmit(body);
    }

    if (url.pathname === "/claim-prizes" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      return this.handleClaimPrizes(body);
    }

    if (url.pathname === "/history" && request.method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      return this.handleHistory(limit);
    }

    const episodeMatch = url.pathname.match(/^\/episode\/(\d+)$/);
    if (episodeMatch && request.method === "GET") return this.handleEpisode(Number(episodeMatch[1]), playerId);

    return json({ error: "not found" }, 404);
  }
}
