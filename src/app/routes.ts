import type { Screen } from "../types/GameMode";
import type { DecodedSharedArtistResult, DecodedSharedResult } from "../services/shareLink";
import type { DailyHistoryEntry } from "../services/dailyChallengeApi";
import type { PenColorId, PenSkinId } from "./constants";

export type { Screen };

/**
 * The public marketing home at "/" (web only). Distinct from `toHome()`, which
 * is the game's own home screen - the site links into that one, never replaces
 * it, so Daily Challenge, Create, My Challenges and the Shop keep their single
 * entry point.
 */
export function toSiteHome(): Screen {
  return { name: "siteHome" };
}

/** The SEO/practice landing presentation (web only). */
export function toSeoLanding(): Screen {
  return { name: "seoLanding" };
}

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

/** 2 Players - the local, same-device mode. No code and no link: everything about it lives on this one device. */
export function toPassPlay(): Screen {
  return { name: "passPlay" };
}

/** Play Together. `joinCode` is set when the player arrived on /join/<code>, so the join form opens prefilled. */
export function toPlayTogether(joinCode?: string): Screen {
  return { name: "playTogether", joinCode };
}
