import type { DecodedSharedResult } from "../services/shareLink";

export type Screen =
  | { name: "home" }
  | { name: "create" }
  | { name: "list" }
  | { name: "play"; challengeId: string }
  | { name: "shapeChallenge" }
  | { name: "settings" }
  | { name: "shop"; from: Screen }
  | { name: "achievements"; from: Screen }
  | { name: "instructions"; from: Screen }
  | { name: "sharedResult"; data: DecodedSharedResult };
