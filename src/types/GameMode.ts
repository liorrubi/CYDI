import type { DecodedSharedArtistResult, DecodedSharedResult } from "../services/shareLink";
import type { DailyHistoryEntry } from "../services/dailyChallengeApi";
import type { PenColorId, PenSkinId } from "../app/constants";

export type Screen =
  /**
   * WEB ONLY - the public marketing home at "/" (art direction 3a). It is a
   * separate destination from "home": "home" is and stays the GAME's home
   * screen, which Android boots straight into and which the web reaches at
   * "/play". Nothing under src/site/ is rendered on native.
   */
  | { name: "siteHome" }
  /** WEB ONLY - the SEO/practice landing presentation (art direction 4a). */
  | { name: "seoLanding" }
  | { name: "home" }
  | { name: "create" }
  | { name: "list" }
  | { name: "play"; challengeId: string; from?: Screen }
  | { name: "friendChallengeIntro"; challengeId: string }
  | { name: "shapeChallenge" }
  | { name: "settings" }
  | { name: "shop"; from: Screen; highlightPenColorId?: PenColorId; highlightPenSkinId?: PenSkinId }
  | { name: "achievements"; from: Screen }
  | { name: "instructions"; from: Screen }
  | { name: "sharedResult"; data: DecodedSharedResult }
  | { name: "sharedArtistResult"; data: DecodedSharedArtistResult }
  | { name: "dailyChallenge" }
  | { name: "dailyChallengeHistory" }
  | { name: "dailyChallengeReplay"; entry: DailyHistoryEntry }
  | { name: "specialChallenge" }
  | { name: "megaChallenge" }
  | { name: "artistPack"; packId: string; from: Screen; replyTo?: DecodedSharedArtistResult }
  | { name: "playTogether"; joinCode?: string }
  | { name: "passPlay" };
