import { useEffect, useRef, useState } from "react";
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
  type PenColorId,
} from "../app/constants";
import { MEGA_ALBUM_SIZE, MEGA_CARDS, type MegaCardDefinition } from "../engine/megaShapeLibrary";
import { getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { collectedMegaCardCount, getMegaProgress, isMegaChallengeUnlocked, unlockMegaCard } from "../services/megaChallengeStore";
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
  /** Pen color to scroll to and briefly highlight in the Ink Colors section - set when the player tapped a locked color in the pen menu. */
  highlightPenColorId?: PenColorId;
  onNavigate: (screen: Screen) => void;
};

// How long the tapped-from-pen-menu color card stays visually highlighted.
const HIGHLIGHT_DURATION_MS = 1800;

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

const TIER_LABELS: Record<"random" | MegaRarity, string> = {
  random: "Random",
  rare: MEGA_RARITY_LABELS.rare,
  epic: MEGA_RARITY_LABELS.epic,
  legendary: MEGA_RARITY_LABELS.legendary,
};

function lockedMegaCards(rarity?: MegaRarity): MegaCardDefinition[] {
  const unlockedIds = getMegaProgress().unlockedCardIds;
  return MEGA_CARDS.filter((card) => !unlockedIds.includes(card.id) && (rarity === undefined || card.rarity === rarity));
}

export default function ShopScreen({ from, highlightPenColorId, onNavigate }: ShopScreenProps) {
  const [coins, setCoins] = useState(() => getCoins());
  const [unlocked, setUnlocked] = useState(() => getUnlockedColors());
  const [pendingChestReveal, setPendingChestReveal] = useState<{ tier: ChestTier; amount: number } | null>(null);
  const [revealedMegaCard, setRevealedMegaCard] = useState<MegaCardDefinition | null>(null);
  // Bumped after each pack purchase so the "left in pool" counts re-render.
  const [megaPurchaseCount, setMegaPurchaseCount] = useState(0);
  const [megaUnlocked] = useState(() => isMegaChallengeUnlocked());
  // Transient toast shown when a locked Mega price button is tapped before the feature is unlocked.
  const [megaLockToast, setMegaLockToast] = useState(false);
  // Briefly highlights the ink color the player tapped from the (locked) pen menu.
  const [highlightedColor, setHighlightedColor] = useState<PenColorId | null>(highlightPenColorId ?? null);
  const colorCardRefs = useRef(new Map<PenColorId, HTMLDivElement>());
  const megaCollected = collectedMegaCardCount();
  const megaProgressPercent = Math.round((megaCollected / MEGA_ALBUM_SIZE) * 100);

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  // Deep-link from the pen menu: jump straight to the Ink Colors section and
  // flash the specific color the player tried to pick, instead of just
  // dropping them on the shop's home screen.
  useEffect(() => {
    if (!highlightPenColorId) return;
    colorCardRefs.current.get(highlightPenColorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = window.setTimeout(() => setHighlightedColor(null), HIGHLIGHT_DURATION_MS);
    return () => window.clearTimeout(timeout);
    // Runs once on mount for the color this screen instance was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Mega Challenge feature must be unlocked (in Shape Challenge) before any
    // Mega card can be bought. Tapping a locked pack shows a toast instead of
    // charging coins or pulling a card.
    if (!megaUnlocked) {
      setMegaLockToast(true);
      window.setTimeout(() => setMegaLockToast(false), 2500);
      return;
    }
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
      <button type="button" className="shop-section-heading" onClick={() => onNavigate(toMegaChallenge())}>
        <h2>Mega Cards</h2>
        <span className="shop-section-heading-arrow" aria-hidden="true">›</span>
      </button>
      <p className="shop-section-subtitle">Complete your Mega Album with random card packs.</p>
      <div className="card shop-mega-progress">
        <div className="shop-mega-progress-row">
          <span>
            Mega Album: {megaCollected} / {MEGA_ALBUM_SIZE} collected
          </span>
          <span>{megaProgressPercent}%</span>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${megaProgressPercent}%` }} />
        </div>
      </div>
      {!megaUnlocked && (
        <button type="button" className="shop-mega-cta" onClick={() => onNavigate(toShapeChallenge())}>
          🔒 Open Mega Challenge first ›
        </button>
      )}
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
          const tier = product.rarity ?? "random";
          const pool = lockedMegaCards(product.rarity);
          const soldOut = pool.length === 0;
          const canAfford = coins >= product.price;
          return (
            <div
              key={product.id}
              className={`card shop-product shop-mega-pack shop-mega-pack-${tier}${megaUnlocked ? "" : " shop-mega-pack-locked"}`}
            >
              <span className={`shop-mega-pack-icon shop-mega-pack-icon-${tier}`} aria-hidden="true">
                {product.icon}
              </span>
              <div className="shop-product-info">
                <div className="shop-chest-title">
                  <h3>{product.name}</h3>
                  <span className={`shop-tier-badge shop-tier-badge-${tier}`}>{TIER_LABELS[tier]}</span>
                </div>
                <p className="status-text">
                  {soldOut ? "All cards of this kind are collected!" : "Unlocks a random Mega Album drawing"}
                </p>
                {megaUnlocked && !soldOut && (
                  <span className="shop-mega-left-badge">
                    {pool.length} card{pool.length === 1 ? "" : "s"} left
                  </span>
                )}
              </div>
              {!megaUnlocked ? (
                <div className="shop-mega-pack-action">
                  <Button className="btn-locked" aria-disabled="true" onClick={() => handleBuyMegaPack(product)}>
                    🔒 {product.price}
                  </Button>
                </div>
              ) : soldOut ? (
                <span className="shop-product-owned">✓ Collected</span>
              ) : (
                <div className="shop-mega-pack-action">
                  <Button disabled={!canAfford} onClick={() => handleBuyMegaPack(product)}>
                    🪙 {product.price}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {megaLockToast && <div className="shop-mega-toast" role="status">Open Mega Challenge first</div>}
      <h2>Ink Colors</h2>
      <div className="shop-product-list">
        {PEN_COLOR_PRODUCTS.map((color) => {
          const owned = unlocked.includes(color.id);
          const price = color.price ?? 0;
          const canAfford = coins >= price;
          return (
            <div
              key={color.id}
              ref={(el) => {
                if (el) colorCardRefs.current.set(color.id, el);
                else colorCardRefs.current.delete(color.id);
              }}
              className={`card shop-product${highlightedColor === color.id ? " shop-product-highlight" : ""}`}
            >
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
