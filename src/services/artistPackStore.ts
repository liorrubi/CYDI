import { coinsForStars, passScoreForDifficulty, starRatingForScore } from "../app/constants";
import { getVisibleArtworks, type ArtistPackDefinition } from "../engine/artistPackLibrary";
import { getDifficulty } from "./difficultySettings";
import { getSaveData, updateSaveData } from "./saveStore";

// Artist Packs are always free — there is no unlock/purchase state here, only
// per-artwork best scores (drawing still earns the usual star-based coin reward).
export type ArtistPacksProgress = {
  /** Best score per artwork id (same convention as shapeChallenge/megaChallenge). */
  bestScores: Record<string, number>;
};

/** Saves written before Artist Packs shipped have no `artistPacks` field (loading doesn't merge in new defaults), so every read normalizes with fallbacks. */
export function getArtistPacksProgress(): ArtistPacksProgress {
  const stored = getSaveData().progress.artistPacks;
  return {
    bestScores: stored?.bestScores ?? {},
  };
}

function saveProgress(progress: ArtistPacksProgress): void {
  updateSaveData((data) => {
    data.progress.artistPacks = progress;
  });
}

export function getArtistPackBestScore(artworkId: string): number | undefined {
  return getArtistPacksProgress().bestScores[artworkId];
}

/** How many of a pack's visible artworks the player has drawn at or above the current difficulty's pass score — the pack's "progress". In production this is published artwork only; in development it also includes drafts under review. */
export function getArtistPackCompletedCount(pack: ArtistPackDefinition): number {
  const pass = passScoreForDifficulty(getDifficulty());
  const best = getArtistPacksProgress().bestScores;
  return getVisibleArtworks(pack).filter((artwork) => (best[artwork.id] ?? -1) >= pass).length;
}

export type ArtistPackResultOutcome = {
  beatBest: boolean;
  /** Coins earned right now — only the star-tier improvement over the previous best (0 on equal/lower replays), mirroring ShapePlay so replays never overpay. */
  starCoins: number;
};

/** Records a finished attempt: updates the artwork's best score and returns the star-delta coin reward for the caller to credit. */
export function recordArtistPackResult(artworkId: string, score: number): ArtistPackResultOutcome {
  const progress = getArtistPacksProgress();
  const previousBest = progress.bestScores[artworkId];
  const beatBest = previousBest === undefined || score > previousBest;

  const previousStars = previousBest !== undefined ? starRatingForScore(previousBest) : -1;
  const newStars = starRatingForScore(score);
  const starCoins = Math.max(0, coinsForStars(newStars) - coinsForStars(previousStars));

  if (beatBest) {
    saveProgress({ ...progress, bestScores: { ...progress.bestScores, [artworkId]: score } });
  }
  return { beatBest, starCoins };
}
