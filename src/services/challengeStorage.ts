import type { Challenge } from "../types/Challenge";
import { STORAGE_KEY } from "../app/constants";

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

function readAll(): Challenge[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChallenge);
  } catch {
    return [];
  }
}

function writeAll(challenges: Challenge[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(challenges));
  } catch (error) {
    console.warn("Failed to persist challenges", error);
  }
}

export function getChallenges(): Challenge[] {
  return readAll();
}

export function getChallenge(id: string): Challenge | null {
  return readAll().find((c) => c.id === id) ?? null;
}

export function saveChallenge(challenge: Challenge): void {
  const list = readAll();
  list.push(challenge);
  writeAll(list);
}

export function updateChallenge(challenge: Challenge): void {
  const list = readAll();
  const index = list.findIndex((c) => c.id === challenge.id);
  if (index === -1) {
    list.push(challenge);
  } else {
    list[index] = challenge;
  }
  writeAll(list);
}

export function deleteChallenge(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id));
}

export function clearAllChallenges(): void {
  writeAll([]);
}
