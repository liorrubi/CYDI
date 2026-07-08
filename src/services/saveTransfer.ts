import { SAVE_SCHEMA_VERSION, type SaveData } from "./saveData";
import { backupCurrentSaveData, getSaveData, replaceSaveData } from "./saveStore";

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function decodeUtf8Base64(code: string): string {
  const binary = atob(code);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isSaveDataShape(value: unknown): value is SaveData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.schemaVersion === "number" && typeof v.progress === "object" && v.progress !== null && typeof v.settings === "object" && v.settings !== null;
}

/** Produces a portable backup code (base64-encoded JSON) of the player's full save data, for moving progress to another device or browser by hand. */
export function exportSaveCode(): string {
  return encodeUtf8Base64(JSON.stringify(getSaveData()));
}

export type ImportResult = { ok: true } | { ok: false; error: string };

/** Restores save data from a backup code produced by `exportSaveCode`, replacing everything on this device. Never throws - the code is pasted by hand, so malformed input is expected and reported as a friendly error instead. */
export function importSaveCode(code: string): ImportResult {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Paste a backup code first." };

  let json: string;
  try {
    json = decodeUtf8Base64(trimmed);
  } catch {
    return { ok: false, error: "That doesn't look like a valid backup code." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "That doesn't look like a valid backup code." };
  }

  if (!isSaveDataShape(parsed)) {
    return { ok: false, error: "That doesn't look like a valid backup code." };
  }
  if (parsed.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return { ok: false, error: "This backup code is from an incompatible game version." };
  }

  // Snapshot what's currently on this device before overwriting it, so a bad
  // restore (or a code from the wrong account) can still be recovered from.
  // Only reaches here once the incoming code is fully validated - a rejected
  // code never touches the existing save or this backup.
  try {
    backupCurrentSaveData();
  } catch (error) {
    console.warn("Failed to back up save data before import", error);
    return { ok: false, error: "Couldn't create a safety backup, so the restore was cancelled." };
  }

  replaceSaveData(parsed);
  return { ok: true };
}
