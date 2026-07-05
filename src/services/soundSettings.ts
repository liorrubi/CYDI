const STORAGE_KEY = "cydi.soundEnabled.v1";

export function isSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch (error) {
    console.warn("Failed to persist sound setting", error);
  }
}
