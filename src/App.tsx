import { useState } from "react";
import HomeScreen from "./screens/HomeScreen";
import CreateChallengeScreen from "./screens/CreateChallengeScreen";
import MyChallengesScreen from "./screens/MyChallengesScreen";
import PlayChallengeScreen from "./screens/PlayChallengeScreen";
import ShapeChallengeScreen from "./screens/ShapeChallengeScreen";
import type { Screen } from "./types/GameMode";

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  switch (screen.name) {
    case "home":
      return <HomeScreen onNavigate={setScreen} />;
    case "create":
      return <CreateChallengeScreen onNavigate={setScreen} />;
    case "list":
      return <MyChallengesScreen onNavigate={setScreen} />;
    case "play":
      return <PlayChallengeScreen challengeId={screen.challengeId} onNavigate={setScreen} />;
    case "shapeChallenge":
      return <ShapeChallengeScreen onNavigate={setScreen} />;
  }
}
