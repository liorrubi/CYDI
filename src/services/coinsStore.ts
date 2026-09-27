import { playCashRegisterSound, playCoinsSound } from "../engine/soundEngine";
import { getSaveData, updateSaveData } from "./saveStore";
import type { CoinSink, CoinSource } from "./economyBuckets";
import { onCoinsEarned, onCoinsSpent } from "./economyAnalytics";

const COINS_UPDATED_EVENT = "cydi:coins-updated";

export function getCoins(): number {
  return getSaveData().progress.coins;
}

function saveCoins(amount: number): void {
  updateSaveData((data) => {
    data.progress.coins = amount;
  });
}

let flushScheduled = false;

// Several coin awards (base reward + achievement bonuses) can happen within the
// same synchronous tick. Batch them into a single sound + counter update instead
// of firing overlapping sounds and racing counter animations.
function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    playCoinsSound();
    window.dispatchEvent(new Event(COINS_UPDATED_EVENT));
  }, 0);
}

function creditSilently(amount: number): number {
  const next = getCoins() + amount;
  saveCoins(next);
  return next;
}

/**
 * Adds coins (no-op for non-positive amounts); batches the coin-drop sound and CoinIndicator update with any other awards made in the same tick.
 * `source` is required: every coin that enters the economy says why (economyAnalytics.ts COIN_SOURCE_REPORTING).
 */
export function addCoins(amount: number, source: CoinSource): number {
  if (amount <= 0) return getCoins();
  const next = creditSilently(amount);
  onCoinsEarned(source, amount, next);
  scheduleFlush();
  return next;
}

/** Credits coins to the real balance immediately (nothing is ever lost) but does NOT play a sound or animate the counter - use with `revealPendingCoins()` for a "tap to collect" reveal moment (e.g. an achievement banner). */
export function addCoinsPending(amount: number, source: CoinSource): number {
  if (amount <= 0) return getCoins();
  const next = creditSilently(amount);
  onCoinsEarned(source, amount, next);
  return next;
}

/** Plays the coin-drop sound and animates the counter up to the current balance - use after `addCoinsPending()` once the player "collects" the reward. */
export function revealPendingCoins(): void {
  scheduleFlush();
}

/**
 * Spends coins (no-op for non-positive amounts), plays a cash-register sound, and notifies any mounted CoinIndicator instances.
 * `sink` is required: every coin that leaves the economy says why (economyAnalytics.ts COIN_SINK_REPORTING).
 */
export function spendCoins(amount: number, sink: CoinSink): number {
  if (amount <= 0) return getCoins();
  const next = Math.max(0, getCoins() - amount);
  saveCoins(next);
  onCoinsSpent(sink, amount, next);
  playCashRegisterSound();
  window.dispatchEvent(new Event(COINS_UPDATED_EVENT));
  return next;
}

export function onCoinsChanged(listener: () => void): () => void {
  window.addEventListener(COINS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(COINS_UPDATED_EVENT, listener);
}
