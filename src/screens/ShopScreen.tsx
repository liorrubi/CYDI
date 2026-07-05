import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import { PEN_COLORS, DEFAULT_PEN_COLOR } from "../app/constants";
import { getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { getUnlockedColors, unlockColor } from "../services/penColorStore";
import { toAchievements, toHome, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";

type ShopScreenProps = {
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

const PEN_COLOR_PRODUCTS = PEN_COLORS.filter((color) => color.id !== DEFAULT_PEN_COLOR);

export default function ShopScreen({ from, onNavigate }: ShopScreenProps) {
  const [coins, setCoins] = useState(() => getCoins());
  const [unlocked, setUnlocked] = useState(() => getUnlockedColors());

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  function handlePurchase(id: (typeof PEN_COLOR_PRODUCTS)[number]["id"], price: number) {
    if (coins < price || unlocked.includes(id)) return;
    spendCoins(price);
    unlockColor(id);
    setUnlocked(getUnlockedColors());
  }

  return (
    <div className="screen">
      <AppHeader
        title="Shop"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toShop(from)))}
      />
      <div className="card shop-balance">
        <p className="shop-balance-label">Your balance</p>
        <p className="shop-balance-amount">🪙 {coins}</p>
      </div>
      <div className="shop-product-list">
        {PEN_COLOR_PRODUCTS.map((color) => {
          const owned = unlocked.includes(color.id);
          const price = color.price ?? 0;
          const canAfford = coins >= price;
          return (
            <div key={color.id} className="card shop-product">
              <span className="shop-product-icon" aria-hidden="true">
                {color.icon}
              </span>
              <div className="shop-product-info">
                <h3>{color.name}</h3>
                <p className="status-text">Unlock this ink color for drawing</p>
              </div>
              {owned ? (
                <span className="shop-product-owned">✓ Owned</span>
              ) : (
                <Button disabled={!canAfford} onClick={() => handlePurchase(color.id, price)}>
                  🪙 {price}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {from.name !== "home" && (
        <Button onClick={() => onNavigate(from)}>↩ Return to Game</Button>
      )}
      <Button variant="secondary" onClick={() => onNavigate(toAchievements(toShop(from)))}>
        View Achievements
      </Button>
    </div>
  );
}
