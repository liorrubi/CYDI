import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ChestIcon from "../components/ChestIcon";
import ChestRewardOverlay from "../components/ChestRewardOverlay";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import {
  PEN_COLORS,
  DEFAULT_PEN_COLOR,
  CHEST_TIERS,
  MEGA_RANDOM_CARD_COST,
  MEGA_RANDOM_TIER_COST,
  MEGA_RARITY_LABELS,
  rollChestReward,
  type ChestTier,
  type MegaRarity,
} from "../app/constants";
import { MEGA_CARDS, type MegaCardDefinition } from "../engine/megaShapeLibrary";
import { getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { getMegaProgress, unlockMegaCard } from "../services/megaChallengeStore";
import { getUnlockedColors, setSelectedColor, unlockColor } from "../services/penColorStore";
import { playSuccessSound } from "../engine/soundEngine";
import {
  toAchievements,
  toHome,
  toInstructions,
  toMegaChallenge,
  toSettings,
  toShapeChallenge,
  toShop,
  toSpecialChallenge,
} from "../app/routes";
import type { Screen } from "../types/GameMode";

type ShopScreenProps = {
  from: Screen;
  onNavigate: (screen: Screen) => void;
};

const PEN_COLOR_PRODUCTS = PEN_COLORS.filter((color) => color.id !== DEFAULT_PEN_COLOR);

type MegaPackProduct = {
  id: string;
  name: string;
  icon: string;
  /** Restricts the random pull to one rarity; undefined = any locked card. */
  rarity?: MegaRarity;
  price: number;
};

const MEGA_PACK_PRODUCTS: MegaPackProduct[] = [
  { id: "mega-random", name: "Random Mega Card", icon: "🃏", price: MEGA_RANDOM_CARD_COST },
  { id: "mega-random-rare", name: "Rare Mega Card", icon: "🎴", rarity: "rare", price: MEGA_RANDOM_TIER_COST.rare },
  { id: "mega-random-epic", name: "Epic Mega Card", icon: "🎴", rarity: "epic", price: MEGA_RANDOM_TIER_COST.epic },
  { id: "mega-random-legendary", name: "Legendary Mega Card", icon: "🎴", rarity: "legendary", price: MEGA_RANDOM_TIER_COST.legendary },
];

function lockedMegaCards(rarity?: MegaRarity): MegaCardDefinition[] {
  const unlockedIds = getMegaProgress().unlockedCardIds;
  return MEGA_CARDS.filter((card) => !unlockedIds.includes(card.id) && (rarity === undefined || card.rarity === rarity));
}

export default function ShopScreen({ from, onNavigate }: ShopScreenProps) {
  const [coins, setCoins] = useState(() => getCoins());
  const [unlocked, setUnlocked] = useState(() => getUnlockedColors());
  const [pendingChestReveal, setPendingChestReveal] = useState<{ tier: ChestTier; amount: number } | null>(null);
  const [revealedMegaCard, setRevealedMegaCard] = useState<MegaCardDefinition | null>(null);
  // Bumped after each pack purchase so the "left in pool" counts re-render.
  const [megaPurchaseCount, setMegaPurchaseCount] = useState(0);

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

  function handleBuyMegaPack(product: MegaPackProduct) {
    const pool = lockedMegaCards(product.rarity);
    if (coins < product.price || pool.length === 0) return;
    spendCoins(product.price);
    const card = pool[Math.floor(Math.random() * pool.length)];
    unlockMegaCard(card.id);
    playSuccessSound();
    setRevealedMegaCard(card);
    setMegaPurchaseCount((n) => n + 1);
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
      <h2>Mega Cards</h2>
      {revealedMegaCard && (
        <div className={`card mega-reveal mega-card-${revealedMegaCard.rarity}`}>
          <span className="mega-reveal-preview">
            <ShapePreviewIcon shape={revealedMegaCard} size={64} />
          </span>
          <div className="shop-product-info">
            <div className="shop-chest-title">
              <h3>
                {revealedMegaCard.icon} {revealedMegaCard.name}
              </h3>
              <span className={`mega-rarity-badge mega-rarity-${revealedMegaCard.rarity}`}>
                {MEGA_RARITY_LABELS[revealedMegaCard.rarity]}
              </span>
            </div>
            <p className="status-text">Added to your Mega Album!</p>
          </div>
          <Button onClick={() => onNavigate(toMegaChallenge())}>View Album</Button>
        </div>
      )}
      <div className="shop-product-list" key={megaPurchaseCount}>
        {MEGA_PACK_PRODUCTS.map((product) => {
          const pool = lockedMegaCards(product.rarity);
          const soldOut = pool.length === 0;
          const canAfford = coins >= product.price;
          return (
            <div key={product.id} className="card shop-product">
              <span className="shop-product-icon" aria-hidden="true">
                {product.icon}
              </span>
              <div className="shop-product-info">
                <div className="shop-chest-title">
                  <h3>{product.name}</h3>
                  {product.rarity && (
                    <span className={`mega-rarity-badge mega-rarity-${product.rarity}`}>
                      {MEGA_RARITY_LABELS[product.rarity]}
                    </span>
                  )}
                </div>
                <p className="status-text">
                  {soldOut
                    ? "All cards of this kind are collected!"
                    : `Unlocks a random Mega Album drawing (${pool.length} left)`}
                </p>
              </div>
              {soldOut ? (
                <span className="shop-product-owned">✓ Collected</span>
              ) : (
                <Button disabled={!canAfford} onClick={() => handleBuyMegaPack(product)}>
                  🪙 {product.price}
                </Button>
              )}
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
