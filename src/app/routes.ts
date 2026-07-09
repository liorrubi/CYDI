import type { Screen } from "../types/GameMode";
import type { DecodedSharedResult } from "../services/shareLink";
import type { DailyHistoryEntry } from "../services/dailyChallengeApi";

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

export function toShapeChallenge(): Screen {
  return { name: "shapeChallenge" };
}

export function toSettings(): Screen {
  return { name: "settings" };
}

export function toShop(from: Screen = { name: "home" }): Screen {
  return { name: "shop", from };
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
