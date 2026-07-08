import { importLegacySaveData } from "./legacyImport";
import { SAVE_SCHEMA_VERSION, type SaveData } from "./saveData";

const SAVE_KEY = "cydi.save.v1";
const SAVE_UPDATED_EVENT = "cydi:save-updated";

let cache: SaveData | null = null;

function isSaveData(value: unknown): value is SaveData {
  return typeof value === "object" && value !== null && typeof (value as SaveData).schemaVersion === "number";
}

function persist(data: SaveData): void {
  cache = data;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("Failed to persist save data", error);
  }
}

function load(): SaveData {
  if (cache) return cache;

  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    raw = null;
  }

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSaveData(parsed)) {
        cache = parsed;
        return cache;
      }
    } catch {
      // Corrupted save blob - fall through to the legacy import / defaults below.
    }
  }

  // First run of the unified save store on this device: fold in whatever the
  // older per-feature localStorage keys hold, so nobody's progress resets.
  const imported = importLegacySaveData();
  persist(imported);
  return imported;
}

/** Read-only snapshot of the current save data. Never mutate the returned object directly - go through `updateSaveData`. */
export function getSaveData(): SaveData {
  return load();
}

/** Applies `mutator` to a fresh copy of the current save data, stamps `updatedAt`, and persists it. Use this for every write instead of touching localStorage directly. */
export function updateSaveData(mutator: (data: SaveData) => void): SaveData {
  const next = structuredClone(load());
  mutator(next);
  next.schemaVersion = SAVE_SCHEMA_VERSION;
  next.updatedAt = Date.now();
  persist(next);
  window.dispatchEvent(new Event(SAVE_UPDATED_EVENT));
  return next;
}

export function onSaveDataChanged(listener: () => void): () => void {
  window.addEventListener(SAVE_UPDATED_EVENT, listener);
  return () => window.removeEventListener(SAVE_UPDATED_EVENT, listener);
}
