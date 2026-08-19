import type { Screen } from "../types/GameMode";
import type { DecodedSharedArtistResult, DecodedSharedResult } from "../services/shareLink";
import type { DailyHistoryEntry } from "../services/dailyChallengeApi";
import type { PenColorId, PenSkinId } from "./constants";

export type { Screen };

export function toHome(): Screen {
  return { name: "home" };
}

export function toCreate(): Screen {
  return { name: "create" };
}

export function toList(): Screen {
  return { name: "list" };
}

/** `from` is the screen Back should return to. Omitted means My Challenges, which is where
 * a challenge is normally opened from; a challenge opened from a friend's link passes home,
 * since a first-time player has no My Challenges list of their own to go back to. */
export function toPlay(challengeId: string, from?: Screen): Screen {
  return { name: "play", challengeId, from };
}

export function toFriendChallengeIntro(challengeId: string): Screen {
  return { name: "friendChallengeIntro", challengeId };
}

export function toShapeChallenge(): Screen {
  return { name: "shapeChallenge" };
}

export function toSettings(): Screen {
  return { name: "settings" };
}

export function toShop(from: Screen = { name: "home" }, highlightPenColorId?: PenColorId, highlightPenSkinId?: PenSkinId): Screen {
  return { name: "shop", from, highlightPenColorId, highlightPenSkinId };
}

export function toAchievements(from: Screen): Screen {
  return { name: "achievements", from };
}

export function toInstructions(from: Screen): Screen {
  return { name: "instructions", from };
}

export function toSharedResult(data: DecodedSharedResult): Screen {
  return { name: "sharedResult", data };
}

export function toSharedArtistResult(data: DecodedSharedArtistResult): Screen {
  return { name: "sharedArtistResult", data };
}

export function toDailyChallenge(): Screen {
  return { name: "dailyChallenge" };
}

export function toDailyChallengeHistory(): Screen {
  return { name: "dailyChallengeHistory" };
}

export function toDailyChallengeReplay(entry: DailyHistoryEntry): Screen {
  return { name: "dailyChallengeReplay", entry };
}

export function toSpecialChallenge(): Screen {
  return { name: "specialChallenge" };
}

export function toMegaChallenge(): Screen {
  return { name: "megaChallenge" };
}

export function toArtistPack(packId: string, from: Screen = { name: "shapeChallenge" }, replyTo?: DecodedSharedArtistResult): Screen {
  return { name: "artistPack", packId, from, replyTo };
}
