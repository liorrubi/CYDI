import { useEffect, useState } from "react";
import AchievementsTutorialOverlay from "./components/AchievementsTutorialOverlay";
import HomeScreen from "./screens/HomeScreen";
import CreateChallengeScreen from "./screens/CreateChallengeScreen";
import MyChallengesScreen from "./screens/MyChallengesScreen";
import PlayChallengeScreen from "./screens/PlayChallengeScreen";
import ShapeChallengeScreen from "./screens/ShapeChallengeScreen";
import ShopScreen from "./screens/ShopScreen";
import AchievementsScreen from "./screens/AchievementsScreen";
import InstructionsScreen from "./screens/InstructionsScreen";
import { toAchievements } from "./app/routes";
import { markAchievementsTutorialShown, onRoundCompleted, shouldShowAchievementsTutorial } from "./services/tutorialStore";
import type { Screen } from "./types/GameMode";

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [showAchievementsTutorial, setShowAchievementsTutorial] = useState(() => shouldShowAchievementsTutorial());

  useEffect(
    () =>
      onRoundCompleted(() => {
        if (shouldShowAchievementsTutorial()) setShowAchievementsTutorial(true);
      }),
    [],
  );

  function dismissAchievementsTutorial() {
    markAchievementsTutorialShown();
    setShowAchievementsTutorial(false);
  }

  function handleTutorialNavigateToAchievements() {
    markAchievementsTutorialShown();
    setShowAchievementsTutorial(false);
    setScreen(toAchievements(screen));
  }

  return (
    <>
      {(() => {
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
          case "shop":
            return <ShopScreen from={screen.from} onNavigate={setScreen} />;
          case "achievements":
            return <AchievementsScreen from={screen.from} onNavigate={setScreen} />;
          case "instructions":
            return <InstructionsScreen from={screen.from} onNavigate={setScreen} />;
        }
      })()}
      {showAchievementsTutorial && (
        <AchievementsTutorialOverlay
          onNavigateToAchievements={handleTutorialNavigateToAchievements}
          onDismiss={dismissAchievementsTutorial}
        />
      )}
    </>
  );
}
