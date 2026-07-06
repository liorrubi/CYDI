export type Screen =
  | { name: "home" }
  | { name: "create" }
  | { name: "list" }
  | { name: "play"; challengeId: string }
  | { name: "shapeChallenge" }
  | { name: "shop"; from: Screen }
  | { name: "achievements"; from: Screen }
  | { name: "instructions"; from: Screen };
