import { useEffect, useRef, useState } from "react";
import { getCoins, onCoinsChanged } from "../services/coinsStore";

const COUNT_ANIMATION_MS = 600;

export default function CoinIndicator() {
  const [displayedCoins, setDisplayedCoins] = useState(() => getCoins());
  const displayedRef = useRef(displayedCoins);
  displayedRef.current = displayedCoins;

  useEffect(() => {
    return onCoinsChanged(() => {
      const target = getCoins();
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

  return (
    <span className="coin-indicator" aria-label={`${displayedCoins} CYDI Coins`}>
      🪙 {displayedCoins}
    </span>
  );
}
