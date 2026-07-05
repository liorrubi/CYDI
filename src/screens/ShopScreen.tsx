import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { toAchievements, toHome } from "../app/routes";
import type { Screen } from "../types/GameMode";

type ShopScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function ShopScreen({ onNavigate }: ShopScreenProps) {
  const [coins, setCoins] = useState(() => getCoins());

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  return (
    <div className="screen">
      <AppHeader
        title="Shop"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements())}
      />
      <div className="card shop-balance">
        <p className="shop-balance-label">Your balance</p>
        <p className="shop-balance-amount">🪙 {coins}</p>
      </div>
      <div className="card shop-empty">
        <p className="shop-empty-title">🛍️ Products are on the way!</p>
        <p className="status-text">Keep collecting CYDI Coins — new items are coming soon.</p>
      </div>
      <Button variant="secondary" onClick={() => onNavigate(toAchievements())}>
        View Achievements
      </Button>
    </div>
  );
}
