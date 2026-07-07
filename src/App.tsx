/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
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
import SettingsScreen from "./screens/SettingsScreen";
import SharedResultScreen from "./screens/SharedResultScreen";
import { toAchievements, toPlay, toSharedResult } from "./app/routes";
import { recordDailyVisit } from "./services/dailyStreakStore";
import { markAchievementsTutorialShown, onRoundCompleted, shouldShowAchievementsTutorial } from "./services/tutorialStore";
import { getChallenge, updateChallenge } from "./services/challengeStorage";
import { decodeChallengeHash, decodeResultHash, type DecodedSharedChallenge } from "./services/shareLink";
import type { Screen } from "./types/GameMode";

/** Imports a shared challenge idempotently, keeping the recipient's own progress if they've already opened this link before - only `name`/`target` ever sync from the payload, never `createdAt`/`personalBest`/`attempts`. */
function importSharedChallenge(challenge: DecodedSharedChallenge) {
  const existing = getChallenge(challenge.id);
  updateChallenge({
    id: challenge.id,
    name: challenge.name,
    target: challenge.target,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: existing?.updatedAt ?? Date.now(),
    personalBest: existing?.personalBest,
    attempts: existing?.attempts ?? 0,
  });
}

function importSharedScreenFromHash(): Screen | null {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return null;

  const challenge = decodeChallengeHash(hash);
  if (challenge) {
    importSharedChallenge(challenge);
    return toPlay(challenge.id);
  }

  const result = decodeResultHash(hash);
  if (result) return toSharedResult(result);

  return null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const shared = importSharedScreenFromHash();
    if (shared) history.replaceState(null, "", location.pathname + location.search);
    return shared ?? { name: "home" };
  });
  const [showAchievementsTutorial, setShowAchievementsTutorial] = useState(() => shouldShowAchievementsTutorial());

  useEffect(() => {
    recordDailyVisit();
  }, []);

  // Covers opening a share link in a tab that already has CYDI loaded (a
  // hash-only URL change doesn't remount the app, so the mount-time import
  // above never runs on its own for that case).
  useEffect(() => {
    function handleHashChange() {
      const shared = importSharedScreenFromHash();
      if (!shared) return;
      history.replaceState(null, "", location.pathname + location.search);
      setScreen(shared);
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

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
          case "settings":
            return <SettingsScreen onNavigate={setScreen} />;
          case "shop":
            return <ShopScreen from={screen.from} onNavigate={setScreen} />;
          case "achievements":
            return <AchievementsScreen from={screen.from} onNavigate={setScreen} />;
          case "instructions":
            return <InstructionsScreen from={screen.from} onNavigate={setScreen} />;
          case "sharedResult":
            return <SharedResultScreen data={screen.data} onNavigate={setScreen} />;
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
