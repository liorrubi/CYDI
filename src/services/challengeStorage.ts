import type { Challenge } from "../types/Challenge";
import { getSaveData, updateSaveData } from "./saveStore";

function isChallenge(value: unknown): value is Challenge {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    typeof c.createdAt === "number" &&
    typeof c.updatedAt === "number" &&
    typeof c.attempts === "number" &&
    typeof c.target === "object" &&
    c.target !== null &&
    Array.isArray((c.target as Record<string, unknown>).points)
  );
}

export function getChallenges(): Challenge[] {
  return getSaveData().progress.challenges.filter(isChallenge);
}

export function getChallenge(id: string): Challenge | null {
  return getChallenges().find((c) => c.id === id) ?? null;
}

export function saveChallenge(challenge: Challenge): void {
  updateSaveData((data) => {
    data.progress.challenges.push(challenge);
  });
}

export function updateChallenge(challenge: Challenge): void {
  updateSaveData((data) => {
    const index = data.progress.challenges.findIndex((c) => c.id === challenge.id);
    if (index === -1) {
      data.progress.challenges.push(challenge);
    } else {
      data.progress.challenges[index] = challenge;
    }
  });
}

export function deleteChallenge(id: string): void {
  updateSaveData((data) => {
    data.progress.challenges = data.progress.challenges.filter((c) => c.id !== id);
  });
}

export function clearAllChallenges(): void {
  updateSaveData((data) => {
    data.progress.challenges = [];
  });
}
