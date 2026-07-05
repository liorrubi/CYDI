export type Screen =
  | { name: "home" }
  | { name: "create" }
  | { name: "list" }
  | { name: "play"; challengeId: string }
  | { name: "shapeChallenge" }
  | { name: "shop" }
  | { name: "achievements"; from: Screen };
