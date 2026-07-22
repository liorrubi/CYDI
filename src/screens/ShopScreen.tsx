import { useEffect, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import ChestIcon from "../components/ChestIcon";
import ChestRewardOverlay from "../components/ChestRewardOverlay";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import PenSkinGlyph from "../components/PenSkinGlyph";
import {
  PEN_COLORS,
  DEFAULT_PEN_COLOR,
  PEN_SKINS,
  DEFAULT_PEN_SKIN,
  CHEST_TIERS,
  MEGA_RANDOM_CARD_COST,
  MEGA_RANDOM_TIER_COST,
  MEGA_RARITY_LABELS,
  rollChestReward,
  type ChestTier,
  type ChestTierId,
  type MegaRarity,
  type PenColorId,
  type PenSkinId,
} from "../app/constants";
import { getMegaAlbumSize, getMegaCards, type MegaCardDefinition } from "../content/contentRepository";
import { getCoins, onCoinsChanged, spendCoins } from "../services/coinsStore";
import { isChestOnCooldown, msUntilChestAvailable, startChestCooldown } from "../services/chestCooldownStore";
import { collectedMegaCardCount, getMegaProgress, isMegaChallengeUnlocked, unlockMegaCard } from "../services/megaChallengeStore";
import { getUnlockedColors, setSelectedColor, unlockColor } from "../services/penColorStore";
import { getUnlockedSkins, setSelectedSkin, unlockSkin } from "../services/penSkinStore";
import { trackEvent } from "../services/analytics";
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
  /** Pen skin to scroll to and briefly highlight in the Drawing Pens section - set when the player tapped a locked skin in the pen style menu. */
  highlightPenSkinId?: PenSkinId;
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
  return getMegaCards().filter((card) => !unlockedIds.includes(card.id) && (rarity === undefined || card.rarity === rarity));
}

function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function snapshotChestCooldowns(): Record<ChestTierId, number> {
  return Object.fromEntries(CHEST_TIERS.map((tier) => [tier.id, msUntilChestAvailable(tier.id)])) as Record<ChestTierId, number>;
}

/** Ticks every second so each chest tier's "buy again in MM:SS" button re-renders live and re-enables itself the instant its cooldown expires. */
function useChestCooldowns(): Record<ChestTierId, number> {
  const [remaining, setRemaining] = useState<Record<ChestTierId, number>>(snapshotChestCooldowns);
  useEffect(() => {
    const intervalId = window.setInterval(() => setRemaining(snapshotChestCooldowns()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);
  return remaining;
}

export default function ShopScreen({ from, highlightPenColorId, highlightPenSkinId, onNavigate }: ShopScreenProps) {
  const [coins, setCoins] = useState(() => getCoins());
  const [unlocked, setUnlocked] = useState(() => getUnlockedColors());
  const [unlockedSkins, setUnlockedSkins] = useState(() => getUnlockedSkins());
  const [pendingChestReveal, setPendingChestReveal] = useState<{ tier: ChestTier; amount: number } | null>(null);
  const [revealedMegaCard, setRevealedMegaCard] = useState<MegaCardDefinition | null>(null);
  // Bumped after each pack purchase so the "left in pool" counts re-render.
  const [megaPurchaseCount, setMegaPurchaseCount] = useState(0);
  const [megaUnlocked] = useState(() => isMegaChallengeUnlocked());
  // Transient toast shown when a locked Mega price button is tapped before the feature is unlocked.
  const [megaLockToast, setMegaLockToast] = useState(false);
  // Briefly highlights the ink color the player tapped from the (locked) pen menu.
  const [highlightedColor, setHighlightedColor] = useState<PenColorId | null>(highlightPenColorId ?? null);
  // Briefly highlights the pen skin the player tapped from the (locked) pen style menu.
  const [highlightedSkin, setHighlightedSkin] = useState<PenSkinId | null>(highlightPenSkinId ?? null);
  const colorCardRefs = useRef(new Map<PenColorId, HTMLDivElement>());
  const skinCardRefs = useRef(new Map<PenSkinId, HTMLDivElement>());
  const chestCooldowns = useChestCooldowns();
  const megaCollected = collectedMegaCardCount();
  const megaAlbumSize = getMegaAlbumSize();
  const megaProgressPercent = Math.round((megaCollected / megaAlbumSize) * 100);

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

  // Same deep-link behavior, for a locked pen skin tapped from the pen style menu.
  useEffect(() => {
    if (!highlightPenSkinId) return;
    skinCardRefs.current.get(highlightPenSkinId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = window.setTimeout(() => setHighlightedSkin(null), HIGHLIGHT_DURATION_MS);
    return () => window.clearTimeout(timeout);
    // Runs once on mount for the skin this screen instance was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePurchase(id: (typeof PEN_COLOR_PRODUCTS)[number]["id"], price: number) {
    if (coins < price || unlocked.includes(id)) return;
    spendCoins(price);
    unlockColor(id);
    setSelectedColor(id);
    setUnlocked(getUnlockedColors());
    trackEvent("purchase_completed", { productType: "penColor", tier: id, price });
  }

  function handleBuySkin(id: PenSkinId, price: number) {
    if (coins < price || unlockedSkins.includes(id)) return;
    spendCoins(price);
    unlockSkin(id);
    // Auto-equip on purchase, mirroring handlePurchase's auto-select for ink colors.
    // Equipping a different owned skin afterward happens via the in-game pen style
    // menu, not here - this shop card only ever shows Owned/Buy, like Ink Colors.
    setSelectedSkin(id);
    setUnlockedSkins(getUnlockedSkins());
    playSuccessSound();
    trackEvent("purchase_completed", { productType: "penSkin", tier: id, price });
  }

  function handleBuyKey(tier: ChestTier) {
    // Re-checked straight from save data (not the ticking React state) at the moment of
    // the click, before any coins move or a reward is rolled, so a click that lands right
    // as the cooldown state is stale (or a rapid double-click) can't double-charge.
    if (coins < tier.price || isChestOnCooldown(tier.id)) return;
    spendCoins(tier.price);
    startChestCooldown(tier.id);
    setPendingChestReveal({ tier, amount: rollChestReward(tier.rewardMin, tier.rewardMax) });
    trackEvent("purchase_completed", { productType: "chestKey", tier: tier.id, price: tier.price });
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
    trackEvent("purchase_completed", { productType: "megaCard", tier: card.rarity, price: product.price });
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
          const cooldownMs = chestCooldowns[tier.id] ?? 0;
          const onCooldown = cooldownMs > 0;
          const canAfford = coins >= tier.price && !onCooldown;
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
                {onCooldown ? `⏱ ${formatCooldown(cooldownMs)}` : `🪙 ${tier.price}`}
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
            Mega Album: {megaCollected} / {megaAlbumSize} collected
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
      <h2>Drawing Pens</h2>
      <p className="shop-section-subtitle">Cosmetic pens for your drawing cursor — purely for looks.</p>
      <div className="shop-product-list">
        {PEN_SKINS.map((skin) => {
          const owned = unlockedSkins.includes(skin.id);
          const isFree = skin.id === DEFAULT_PEN_SKIN;
          const price = skin.price ?? 0;
          const canAfford = coins >= price;
          return (
            <div
              key={skin.id}
              ref={(el) => {
                if (el) skinCardRefs.current.set(skin.id, el);
                else skinCardRefs.current.delete(skin.id);
              }}
              className={`card shop-product shop-pen-skin${highlightedSkin === skin.id ? " shop-product-highlight" : ""}`}
            >
              <span className="shop-pen-skin-icon" aria-hidden="true">
                <svg width="42" height="42" viewBox="0 0 44 44" fill="none">
                  <PenSkinGlyph skin={skin.id} inkColor="#1e202e" />
                </svg>
              </span>
              <div className="shop-product-info">
                <h3>{skin.name}</h3>
                <p className="status-text">{owned ? (isFree ? "Free" : "Owned") : `🪙 ${price}`}</p>
              </div>
              {owned ? (
                <span className="shop-product-owned">✓ Owned</span>
              ) : (
                <div className="shop-pen-skin-action">
                  <Button disabled={!canAfford} onClick={() => handleBuySkin(skin.id, price)}>
                    Buy
                  </Button>
                  {!canAfford && <span className="shop-pen-skin-hint">Not enough coins</span>}
                </div>
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
