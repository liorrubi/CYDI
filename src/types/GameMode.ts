import type { DecodedSharedResult } from "../services/shareLink";
import type { DailyHistoryEntry } from "../services/dailyChallengeApi";
import type { PenColorId } from "../app/constants";

export type Screen =
  | { name: "home" }
  | { name: "create" }
  | { name: "list" }
  | { name: "play"; challengeId: string }
  | { name: "friendChallengeIntro"; challengeId: string }
  | { name: "shapeChallenge" }
  | { name: "settings" }
  | { name: "shop"; from: Screen; highlightPenColorId?: PenColorId }
  | { name: "achievements"; from: Screen }
  | { name: "instructions"; from: Screen }
  | { name: "sharedResult"; data: DecodedSharedResult }
  | { name: "dailyChallenge" }
  | { name: "dailyChallengeHistory" }
  | { name: "dailyChallengeReplay"; entry: DailyHistoryEntry }
  | { name: "specialChallenge" }
  | { name: "megaChallenge" };
