import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { hasAffordableUnpurchasedProduct } from "../services/penColorStore";
import { hasAffordableUnpurchasedSkin } from "../services/penSkinStore";
import { flyCoinsToTarget, onCoinFlightRequested } from "../engine/coinFlight";

/** True when any shop cosmetic the player doesn't own yet is now affordable (pen ink color or pen skin). */
function canAffordNewCosmetic(): boolean {
  return hasAffordableUnpurchasedProduct() || hasAffordableUnpurchasedSkin();
}

const COUNT_ANIMATION_MS = 600;

type CoinIndicatorProps = {
  /** When provided, the indicator becomes a button (e.g. a shortcut into the shop). Omit to keep it a plain, non-interactive display. */
  onClick?: () => void;
};

export default function CoinIndicator({ onClick }: CoinIndicatorProps) {
  const [displayedCoins, setDisplayedCoins] = useState(() => getCoins());
  const displayedRef = useRef(displayedCoins);
  displayedRef.current = displayedCoins;
  const indicatorRef = useRef<HTMLElement | null>(null);
  // Only relevant when this indicator doubles as the shop shortcut button.
  const [canAffordSomething, setCanAffordSomething] = useState(() => canAffordNewCosmetic());
  const tweenIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = onCoinsChanged(() => {
      const target = getCoins();
      setCanAffordSomething(canAffordNewCosmetic());
      const start = displayedRef.current;
      if (start === target) return;

      // A prior tween that hasn't finished (rapid back-to-back coin changes)
      // must be cancelled first, or both intervals would fight over displayedCoins.
      if (tweenIntervalRef.current !== null) window.clearInterval(tweenIntervalRef.current);

      // Driven by setInterval rather than requestAnimationFrame: rAF callbacks
      // are fully paused (not just throttled) while the tab is hidden/backgrounded,
      // which left this counter frozen mid-count until the tab regained focus.
      // setInterval keeps ticking (only throttled) so the count-up always reaches
      // its target instead of getting stuck on a stale number.
      const startTime = performance.now();
      tweenIntervalRef.current = window.setInterval(() => {
        const progress = Math.min((performance.now() - startTime) / COUNT_ANIMATION_MS, 1);
        const eased = 1 - (1 - progress) ** 3;
        setDisplayedCoins(Math.round(start + (target - start) * eased));
        if (progress >= 1 && tweenIntervalRef.current !== null) {
          window.clearInterval(tweenIntervalRef.current);
          tweenIntervalRef.current = null;
        }
      }, 16);
    });
    return () => {
      unsubscribe();
      if (tweenIntervalRef.current !== null) window.clearInterval(tweenIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    return onCoinFlightRequested((sourceEl) => {
      if (indicatorRef.current) flyCoinsToTarget(sourceEl, indicatorRef.current);
    });
  }, []);

  if (onClick) {
    const label = canAffordSomething
      ? `${displayedCoins} CYDI Coins - open shop - something new is affordable`
      : `${displayedCoins} CYDI Coins - open shop`;
    return (
      <button
        ref={indicatorRef as RefObject<HTMLButtonElement>}
        type="button"
        className="coin-indicator coin-indicator-button"
        aria-label={label}
        onClick={onClick}
      >
        🪙 {displayedCoins}
        {canAffordSomething && <span className="coin-indicator-alert" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <span ref={indicatorRef as RefObject<HTMLSpanElement>} className="coin-indicator" aria-label={`${displayedCoins} CYDI Coins`}>
      🪙 {displayedCoins}
    </span>
  );
}
