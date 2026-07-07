import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { hasAffordableUnpurchasedProduct } from "../services/penColorStore";
import { flyCoinsToTarget, onCoinFlightRequested } from "../engine/coinFlight";

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
  const [canAffordSomething, setCanAffordSomething] = useState(() => hasAffordableUnpurchasedProduct());

  useEffect(() => {
    return onCoinsChanged(() => {
      const target = getCoins();
      setCanAffordSomething(hasAffordableUnpurchasedProduct());
      const start = displayedRef.current;
      if (start === target) return;

      const startTime = performance.now();
      function step(now: number) {
        const progress = Math.min((now - startTime) / COUNT_ANIMATION_MS, 1);
        const eased = 1 - (1 - progress) ** 3;
        setDisplayedCoins(Math.round(start + (target - start) * eased));
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
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
