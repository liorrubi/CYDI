import AppHeader from "../components/AppHeader";
import { APP_TAGLINE } from "../app/constants";
import { toAchievements, toCreate, toList, toShapeChallenge, toShop } from "../app/routes";
import { playSelectSound } from "../engine/soundEngine";
import type { Screen } from "../types/GameMode";

type HomeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  function handleSelect(screen: Screen) {
    playSelectSound();
    onNavigate(screen);
  }

  return (
    <div className="screen">
      <AppHeader subtitle={APP_TAGLINE} onNavigateToAchievements={() => handleSelect(toAchievements())} />
      <div className="home-cards">
        <button
          type="button"
          className="card home-card home-card-accent-green"
          onClick={() => handleSelect(toCreate())}
        >
          <h2>Create Challenge</h2>
          <p>Make a shape to play</p>
        </button>
        <button type="button" className="card home-card home-card-accent-blue" onClick={() => handleSelect(toList())}>
          <h2>My Challenges</h2>
          <p>Play saved challenges</p>
        </button>
        <button
          type="button"
          className="card home-card home-card-accent-purple"
          onClick={() => handleSelect(toShapeChallenge())}
        >
          <h2>Shape Challenge</h2>
          <p>Draw what the game shows you</p>
        </button>
        <div className="card home-card disabled home-card-accent-orange" aria-disabled="true">
          <h2>Daily Challenge</h2>
          <p>Coming soon</p>
        </div>
        <button
          type="button"
          className="card home-card home-card-accent-gold"
          onClick={() => handleSelect(toShop())}
        >
          <h2>🪙 Shop</h2>
          <p>Spend your CYDI Coins</p>
        </button>
      </div>
    </div>
  );
}
