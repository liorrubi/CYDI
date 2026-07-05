import type { Screen } from "../types/GameMode";

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
