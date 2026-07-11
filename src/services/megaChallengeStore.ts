import { MEGA_COMPLETION_REWARD, MEGA_PERFECT_SCORE } from "../app/constants";
import { MEGA_CARDS, getMegaCardById, type MegaCardDefinition } from "../engine/megaShapeLibrary";
import { getUnlockedAchievementIds } from "./achievementsStore";
import { getSaveData, updateSaveData } from "./saveStore";
import { isUnlockEverythingActive } from "./unlockOverrideStore";
import { trackEvent } from "./analytics";

export type MegaChallengeProgress = {
  unlocked: boolean;
  unlockedCardIds: string[];
  bestScores: Record<string, number>;
  completionRewardClaimedIds: string[];
  perfectCardIds: string[];
  championCelebrated: boolean;
};

/** Saves written before the Mega Challenge shipped have no `megaChallenge` field at all (loading doesn't merge in new defaults), so every read normalizes with fallbacks. */
export function getMegaProgress(): MegaChallengeProgress {
  const stored = getSaveData().progress.megaChallenge;
  return {
    unlocked: stored?.unlocked ?? false,
    unlockedCardIds: stored?.unlockedCardIds ?? [],
    bestScores: stored?.bestScores ?? {},
    completionRewardClaimedIds: stored?.completionRewardClaimedIds ?? [],
    perfectCardIds: stored?.perfectCardIds ?? [],
    championCelebrated: stored?.championCelebrated ?? false,
  };
}

/** Whether the player has paid to unlock the Mega Challenge feature. The album is inaccessible until this is true. The Settings "unlock everything" test toggle forces this open without writing to real progress, so flipping it back off restores the true state. */
export function isMegaChallengeUnlocked(): boolean {
  return isUnlockEverythingActive() || getMegaProgress().unlocked;
}

/**
 * Permanently unlocks the Mega Challenge feature and grants the first card for
 * free. Idempotent: returns false and changes nothing if it was already
 * unlocked, so a caller can safely guard the coin charge against double-paying.
 * Does NOT touch coins - the caller spends them only when this returns true.
 */
export function unlockMegaChallenge(): boolean {
  const progress = getMegaProgress();
  if (progress.unlocked) return false;
  const firstCardId = MEGA_CARDS[0]?.id;
  const unlockedCardIds =
    firstCardId && !progress.unlockedCardIds.includes(firstCardId)
      ? [...progress.unlockedCardIds, firstCardId]
      : progress.unlockedCardIds;
  saveMegaProgress({ ...progress, unlocked: true, unlockedCardIds });
  return true;
}

function saveMegaProgress(progress: MegaChallengeProgress): void {
  updateSaveData((data) => {
    data.progress.megaChallenge = progress;
  });
}

/** Honors the Settings "unlock everything" test toggle (all cards open) without persisting anything, so it reverts to real progress when the toggle is off. */
export function isMegaCardUnlocked(id: string): boolean {
  return isUnlockEverythingActive() || getMegaProgress().unlockedCardIds.includes(id);
}

export function unlockMegaCard(id: string): void {
  const card = getMegaCardById(id);
  if (!card) return;
  const progress = getMegaProgress();
  if (progress.unlockedCardIds.includes(id)) return;
  saveMegaProgress({ ...progress, unlockedCardIds: [...progress.unlockedCardIds, id] });
  trackEvent("mega_card_unlocked", { rarity: card.rarity });
}

/** Unlocks every card whose linked achievement the player has already earned. Returns the newly unlocked cards so the album can celebrate them. Called whenever the album opens - a card earned mid-session appears at the latest on the next album visit. */
export function syncAchievementCardUnlocks(): MegaCardDefinition[] {
  const progress = getMegaProgress();
  const earnedAchievements = getUnlockedAchievementIds();
  const newlyUnlocked = MEGA_CARDS.filter(
    (card) => !progress.unlockedCardIds.includes(card.id) && earnedAchievements.includes(card.unlockAchievementId),
  );
  if (newlyUnlocked.length === 0) return [];
  saveMegaProgress({
    ...progress,
    unlockedCardIds: [...progress.unlockedCardIds, ...newlyUnlocked.map((card) => card.id)],
  });
  return newlyUnlocked;
}

export type MegaResultOutcome = {
  beatBest: boolean;
  isPerfect: boolean;
  /** Coins earned right now for this card's first-ever passing score (0 on replays or fails). */
  completionRewardCoins: number;
};

/** Records a finished Mega attempt: best score, one-time completion reward, and the permanent Perfect flag. The caller decides pass/fail (it owns the difficulty setting) and actually credits the returned coins. */
export function recordMegaResult(id: string, score: number, passed: boolean): MegaResultOutcome {
  const card = getMegaCardById(id);
  const progress = getMegaProgress();
  const previousBest = progress.bestScores[id];
  const beatBest = previousBest === undefined || score > previousBest;
  const isPerfect = score >= MEGA_PERFECT_SCORE;
  const rewardDue = passed && card !== undefined && !progress.completionRewardClaimedIds.includes(id);

  saveMegaProgress({
    ...progress,
    bestScores: beatBest ? { ...progress.bestScores, [id]: score } : progress.bestScores,
    completionRewardClaimedIds: rewardDue ? [...progress.completionRewardClaimedIds, id] : progress.completionRewardClaimedIds,
    perfectCardIds: isPerfect && !progress.perfectCardIds.includes(id) ? [...progress.perfectCardIds, id] : progress.perfectCardIds,
  });

  return {
    beatBest,
    isPerfect,
    completionRewardCoins: rewardDue ? MEGA_COMPLETION_REWARD[card.rarity] : 0,
  };
}

/** Cards genuinely collected through real progress, ignoring any test override. */
function realCollectedMegaCardCount(): number {
  return getMegaProgress().unlockedCardIds.filter((id) => getMegaCardById(id)).length;
}

/** Collected count for display (entry card / album progress). Reflects the test override so the UI reads as fully collected while it's active. */
export function collectedMegaCardCount(): number {
  return isUnlockEverythingActive() ? MEGA_CARDS.length : realCollectedMegaCardCount();
}

/** Album complete = every Mega card genuinely collected. Deliberately ignores the test override: the permanent Challenge Champion title must only be earned for real, never faked by (or persisted from) the Settings unlock toggle. */
export function isMegaAlbumComplete(): boolean {
  return realCollectedMegaCardCount() >= MEGA_CARDS.length;
}

export function isChallengeChampion(): boolean {
  return isMegaAlbumComplete();
}

/** Whether the one-time full-album celebration screen still needs to be shown. */
export function shouldCelebrateChampion(): boolean {
  return isMegaAlbumComplete() && !getMegaProgress().championCelebrated;
}

export function markChampionCelebrated(): void {
  const progress = getMegaProgress();
  if (progress.championCelebrated) return;
  saveMegaProgress({ ...progress, championCelebrated: true });
}
