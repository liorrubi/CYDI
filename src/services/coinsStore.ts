import { playCashRegisterSound, playCoinsSound } from "../engine/soundEngine";

const STORAGE_KEY = "cydi.coins.v1";
const COINS_UPDATED_EVENT = "cydi:coins-updated";

export function getCoins(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveCoins(amount: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(amount));
  } catch (error) {
    console.warn("Failed to persist coins", error);
  }
}

/** Adds coins (no-op for non-positive amounts), plays a coin-drop sound, and notifies any mounted CoinIndicator instances. */
export function addCoins(amount: number): number {
  if (amount <= 0) return getCoins();
  const next = getCoins() + amount;
  saveCoins(next);
  playCoinsSound();
  window.dispatchEvent(new Event(COINS_UPDATED_EVENT));
  return next;
}

/** Spends coins (no-op for non-positive amounts), plays a cash-register sound, and notifies any mounted CoinIndicator instances. */
export function spendCoins(amount: number): number {
  if (amount <= 0) return getCoins();
  const next = Math.max(0, getCoins() - amount);
  saveCoins(next);
  playCashRegisterSound();
  window.dispatchEvent(new Event(COINS_UPDATED_EVENT));
  return next;
}

export function onCoinsChanged(listener: () => void): () => void {
  window.addEventListener(COINS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(COINS_UPDATED_EVENT, listener);
}
