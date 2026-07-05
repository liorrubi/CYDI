import AppHeader from "../components/AppHeader";
import { APP_TAGLINE } from "../app/constants";
import { toCreate, toList } from "../app/routes";
import type { Screen } from "../types/GameMode";

type HomeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  return (
    <div className="screen">
      <AppHeader subtitle={APP_TAGLINE} />
      <div className="home-cards">
        <button type="button" className="card home-card" onClick={() => onNavigate(toCreate())}>
          <h2>Create Challenge</h2>
          <p>Make a shape to play</p>
        </button>
        <button type="button" className="card home-card" onClick={() => onNavigate(toList())}>
          <h2>My Challenges</h2>
          <p>Play saved challenges</p>
        </button>
        <div className="card home-card disabled" aria-disabled="true">
          <h2>Daily Challenge</h2>
          <p>Coming soon</p>
        </div>
      </div>
    </div>
  );
}
