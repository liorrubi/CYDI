const COIN_FLIGHT_EVENT = "cydi:coin-flight";
const COIN_FLIGHT_DURATION_MS = 650;

/** Requests a small burst of coin icons animate from the given element toward the coin indicator. */
export function triggerCoinFlight(sourceEl: Element | null): void {
  if (!sourceEl) return;
  window.dispatchEvent(new CustomEvent<Element>(COIN_FLIGHT_EVENT, { detail: sourceEl }));
}

export function onCoinFlightRequested(listener: (sourceEl: Element) => void): () => void {
  function handler(event: Event): void {
    listener((event as CustomEvent<Element>).detail);
  }
  window.addEventListener(COIN_FLIGHT_EVENT, handler);
  return () => window.removeEventListener(COIN_FLIGHT_EVENT, handler);
}

/** Spawns floating coin emoji that fly from the source element's position to the target element's position, then removes themselves. */
export function flyCoinsToTarget(sourceEl: Element, targetEl: Element): void {
  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  const fromX = sourceRect.left + sourceRect.width / 2;
  const fromY = sourceRect.top + sourceRect.height / 2;
  const dx = targetRect.left + targetRect.width / 2 - fromX;
  const dy = targetRect.top + targetRect.height / 2 - fromY;

  const coinCount = 4;
  for (let i = 0; i < coinCount; i++) {
    const coin = document.createElement("span");
    coin.textContent = "🪙";
    coin.className = "flying-coin";
    coin.style.left = `${fromX}px`;
    coin.style.top = `${fromY}px`;
    document.body.appendChild(coin);

    const delay = i * 60;
    const jitterX = (Math.random() - 0.5) * 30;
    const midX = dx * 0.4 + jitterX;
    const midY = dy * 0.4 - 40; // arc upward on the way to the coin indicator

    const animation = coin.animate(
      [
        { transform: "translate(-50%, -50%) translate(0, 0) scale(0.6)", opacity: 0, offset: 0 },
        { transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px) scale(1.1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0, offset: 1 },
      ],
      { duration: COIN_FLIGHT_DURATION_MS, delay, easing: "cubic-bezier(0.3, 0, 0.7, 1)", fill: "forwards" },
    );
    animation.onfinish = () => coin.remove();
  }
}
