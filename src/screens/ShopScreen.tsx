import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ChestIcon from "../components/ChestIcon";
import ChestRewardOverlay from "../components/ChestRewardOverlay";
import { PEN_COLORS, DEFAULT_PEN_COLOR, CHEST_TIERS, rollChestReward, type ChestTier } from "../app/constants";
import { getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { getUnlockedColors, setSelectedColor, unlockColor } from "../services/penColorStore";
import { toAchievements, toHome, toInstructions, toSettings, toShapeChallenge, toShop, toSpecialChallenge } from "../app/routes";
import type { Screen } from "../types/GameMode";

type ShopScreenProps = {
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

const PEN_COLOR_PRODUCTS = PEN_COLORS.filter((color) => color.id !== DEFAULT_PEN_COLOR);

export default function ShopScreen({ from, onNavigate }: ShopScreenProps) {
  const [coins, setCoins] = useState(() => getCoins());
  const [unlocked, setUnlocked] = useState(() => getUnlockedColors());
  const [pendingChestReveal, setPendingChestReveal] = useState<{ tier: ChestTier; amount: number } | null>(null);

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  function handlePurchase(id: (typeof PEN_COLOR_PRODUCTS)[number]["id"], price: number) {
    if (coins < price || unlocked.includes(id)) return;
    spendCoins(price);
    unlockColor(id);
    setSelectedColor(id);
    setUnlocked(getUnlockedColors());
  }

  function handleBuyKey(tier: ChestTier) {
    if (coins < tier.price) return;
    spendCoins(tier.price);
    setPendingChestReveal({ tier, amount: rollChestReward(tier.rewardMin, tier.rewardMax) });
  }

  return (
    <div className="screen">
      <AppHeader
        title="Shop"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toShop(from)))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toShop(from)))}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
        onNavigateToSpecialChallenge={() => onNavigate(toSpecialChallenge())}
        onNavigateToShapeChallenge={() => onNavigate(toShapeChallenge())}
      />
      <div className="card shop-balance">
        <p className="shop-balance-label">Your balance</p>
        <p className="shop-balance-amount">🪙 {coins}</p>
      </div>
      <h2>Chest Keys</h2>
      <div className="shop-product-list">
        {CHEST_TIERS.map((tier) => {
          const canAfford = coins >= tier.price;
          return (
            <div key={tier.id} className={`card shop-product shop-chest shop-chest-${tier.id}`}>
              <span className="chest-tier-icon" aria-hidden="true">
                <ChestIcon tier={tier.id} size={58} />
              </span>
              <div className="shop-product-info">
                <div className="shop-chest-title">
                  <h3>{tier.name}</h3>
                  <span className={`chest-rarity-badge chest-rarity-badge-${tier.id}`}>{tier.rarity}</span>
                </div>
                <p className="status-text shop-chest-reward">
                  Win: 🪙 {tier.rewardMin}–{tier.rewardMax}
                </p>
              </div>
              <Button disabled={!canAfford} onClick={() => handleBuyKey(tier)}>
                🪙 {tier.price}
              </Button>
            </div>
          );
        })}
      </div>
      <h2>Ink Colors</h2>
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
      {pendingChestReveal && (
        <ChestRewardOverlay
          chestName={pendingChestReveal.tier.name}
          tier={pendingChestReveal.tier.id}
          amount={pendingChestReveal.amount}
          rewardMin={pendingChestReveal.tier.rewardMin}
          rewardMax={pendingChestReveal.tier.rewardMax}
          isPaidChest={true}
          onDismissed={() => setPendingChestReveal(null)}
        />
      )}
    </div>
  );
}
