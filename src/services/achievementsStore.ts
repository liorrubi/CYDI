const STORAGE_KEY = "cydi.achievements.v1";

export function getUnlockedAchievementIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markAchievementUnlocked(id: string): void {
  const current = getUnlockedAchievementIds();
  if (current.includes(id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...current, id]));
  } catch (error) {
    console.warn("Failed to persist achievement", error);
  }
}
