import type { Screen } from "../types/GameMode";
import type { DecodedSharedArtistResult, DecodedSharedResult } from "../services/shareLink";
import type { DailyHistoryEntry } from "../services/dailyChallengeApi";
import type { PenColorId } from "./constants";

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

export function toPlay(challengeId: string): Screen {
  return { name: "play", challengeId };
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

export function toShop(from: Screen = { name: "home" }, highlightPenColorId?: PenColorId): Screen {
  return { name: "shop", from, highlightPenColorId };
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

export function toArtistPack(packId: string, from: Screen = { name: "shapeChallenge" }): Screen {
  return { name: "artistPack", packId, from };
}
