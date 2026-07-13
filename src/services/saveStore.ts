import { importLegacySaveData } from "./legacyImport";
import { createDefaultSaveData, SAVE_SCHEMA_VERSION, type SaveData } from "./saveData";

const SAVE_KEY = "cydi.save.v1";
const PRE_IMPORT_BACKUP_KEY = "cydi.save.preImportBackup.v1";
const SAVE_UPDATED_EVENT = "cydi:save-updated";

let cache: SaveData | null = null;

function isSaveData(value: unknown): value is SaveData {
  return typeof value === "object" && value !== null && typeof (value as SaveData).schemaVersion === "number";
}

// A blob that parsed as JSON but failed `isSaveData` (e.g. `schemaVersion` got
// dropped by a bad write) still has real `progress`/`settings` worth keeping -
// falling straight to `importLegacySaveData` would discard every field with no
// legacy-key counterpart (megaChallenge, artistPacks, dailyChest, etc.), even
// though the player's actual progress in the unified blob is otherwise intact.
// This fills in only what's missing from the defaults instead of resetting.
function recoverPartialSaveData(value: unknown): SaveData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<SaveData>;
  if (typeof v.progress !== "object" || v.progress === null) return null;

  const defaults = createDefaultSaveData();
  return {
    ...defaults,
    progress: { ...defaults.progress, ...v.progress },
    settings: typeof v.settings === "object" && v.settings !== null ? { ...defaults.settings, ...v.settings } : defaults.settings,
  };
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
      const recovered = recoverPartialSaveData(parsed);
      if (recovered) {
        persist(recovered);
        return recovered;
      }
    } catch {
      // Invalid JSON, nothing to recover from - fall through to legacy import / defaults below.
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

/**
 * Snapshots the current save data to a separate rescue key, before a destructive
 * replace (e.g. `importSaveCode`). Deliberately does NOT swallow errors like
 * `persist` does - callers must treat a failed backup as a reason to abort the
 * replace, since a failed backup plus a completed overwrite would leave the
 * player with no way back.
 */
export function backupCurrentSaveData(): void {
  localStorage.setItem(PRE_IMPORT_BACKUP_KEY, JSON.stringify(load()));
}

/** Replaces the entire save data wholesale, e.g. restoring from an exported backup code. Unlike `updateSaveData`, this discards whatever was on the device beforehand - callers are responsible for confirming that with the player first, and for backing up via `backupCurrentSaveData` beforehand. */
export function replaceSaveData(data: SaveData): void {
  persist({ ...data, schemaVersion: SAVE_SCHEMA_VERSION, updatedAt: Date.now() });
  window.dispatchEvent(new Event(SAVE_UPDATED_EVENT));
}

export function onSaveDataChanged(listener: () => void): () => void {
  window.addEventListener(SAVE_UPDATED_EVENT, listener);
  return () => window.removeEventListener(SAVE_UPDATED_EVENT, listener);
}
