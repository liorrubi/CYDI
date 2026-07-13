/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import AchievementsTutorialOverlay from "./components/AchievementsTutorialOverlay";
import OnboardingTutorialOverlay from "./components/OnboardingTutorialOverlay";
import HomeScreen from "./screens/HomeScreen";
import CreateChallengeScreen from "./screens/CreateChallengeScreen";
import MyChallengesScreen from "./screens/MyChallengesScreen";
import PlayChallengeScreen from "./screens/PlayChallengeScreen";
import FriendChallengeIntroScreen from "./screens/FriendChallengeIntroScreen";
import ShapeChallengeScreen from "./screens/ShapeChallengeScreen";
import DailyChallengeScreen from "./screens/DailyChallengeScreen";
import DailyChallengeHistoryScreen from "./screens/DailyChallengeHistoryScreen";
import ShopScreen from "./screens/ShopScreen";
import AchievementsScreen from "./screens/AchievementsScreen";
import InstructionsScreen from "./screens/InstructionsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SharedResultScreen from "./screens/SharedResultScreen";
import SharedArtistResultScreen from "./screens/SharedArtistResultScreen";
import SpecialChallengeScreen from "./screens/SpecialChallengeScreen";
import MegaChallengeScreen from "./screens/MegaChallengeScreen";
import ArtistPackScreen from "./screens/ArtistPackScreen";
import { toAchievements, toDailyChallenge, toFriendChallengeIntro, toSharedArtistResult, toSharedResult } from "./app/routes";
import { resolveIncomingAppLinkId, SHORT_LINK_PATH_PATTERN } from "./app/appLinks";
import { recordDailyVisit } from "./services/dailyStreakStore";
import { trackEvent } from "./services/analytics";
import {
  markAchievementsTutorialShown,
  markOnboardingTutorialShown,
  onRoundCompleted,
  shouldShowAchievementsTutorial,
  shouldShowOnboardingTutorial,
} from "./services/tutorialStore";
import { getChallenge, updateChallenge } from "./services/challengeStorage";
import { decodeArtistResultHash, decodeChallengeHash, decodeResultHash, type DecodedSharedChallenge } from "./services/shareLink";
import { fetchSharedById } from "./services/shareApi";
import { isDailyChallengeSharePath } from "./services/dailyChallengeShare";
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
    return toFriendChallengeIntro(challenge.id);
  }

  const result = decodeResultHash(hash);
  if (result) return toSharedResult(result);

  const artistResult = decodeArtistResultHash(hash);
  if (artistResult) return toSharedArtistResult(artistResult);

  return null;
}

function shortLinkIdFromPath(): string | null {
  const match = location.pathname.match(SHORT_LINK_PATH_PATTERN);
  return match ? match[1] : null;
}

/** Resolves a short server-backed link (`/c/<id>`) - the async counterpart to `importSharedScreenFromHash`, needed because this path requires a network round-trip instead of decoding data already present in the URL. */
async function importSharedScreenFromShortId(id: string): Promise<Screen | null> {
  const shared = await fetchSharedById(id);
  if (!shared) return null;

  if (shared.kind === "challenge") {
    importSharedChallenge(shared.data);
    return toFriendChallengeIntro(shared.data.id);
  }
  if (shared.kind === "artistResult") {
    return toSharedArtistResult(shared.data);
  }
  return toSharedResult(shared.data);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const shared = importSharedScreenFromHash();
    if (shared) {
      history.replaceState(null, "", location.pathname + location.search);
      return shared;
    }
    if (isDailyChallengeSharePath(location.pathname)) {
      history.replaceState(null, "", "/" + location.search);
      return toDailyChallenge();
    }
    return { name: "home" };
  });
  const [showAchievementsTutorial, setShowAchievementsTutorial] = useState(() => shouldShowAchievementsTutorial());
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(() => shouldShowOnboardingTutorial());

  // Screen navigation is plain React state, not browser history, so there's
  // nothing for the Android hardware back button to pop by default (it would
  // otherwise exit the app immediately from any screen). This stack mirrors
  // in-app navigation so back-button presses retrace it instead.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const screenHistoryRef = useRef<Screen[]>([]);
  const lastHandledAppLinkUrlRef = useRef<string | null>(null);

  function navigate(next: Screen) {
    screenHistoryRef.current.push(screenRef.current);
    setScreen(next);
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listenerPromise = CapacitorApp.addListener("backButton", () => {
      const previous = screenHistoryRef.current.pop();
      if (previous) {
        setScreen(previous);
        return;
      }
      if (screenRef.current.name === "home") {
        CapacitorApp.exitApp();
      } else {
        setScreen({ name: "home" });
      }
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  // Android App Link (https://playcydi.com/c/<id>) - the native counterpart to
  // the web-only hash/short-link effects below. The WebView's own `location`
  // never changes for these (the URL only ever reaches native code via an
  // Android Intent, singleTask routes it to this same running instance), so
  // the id has to come from getLaunchUrl()/appUrlOpen instead of `location`.
  // Covers both cold start (app wasn't running - getLaunchUrl) and warm start
  // (app already open - appUrlOpen); resolveIncomingAppLinkId's dedup guards
  // against both firing for the same URL, and against a redelivered intent.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    function handleIncomingUrl(rawUrl: string) {
      const id = resolveIncomingAppLinkId(rawUrl, lastHandledAppLinkUrlRef.current);
      if (!id) return;
      lastHandledAppLinkUrlRef.current = rawUrl;
      importSharedScreenFromShortId(id).then((shared) => {
        if (shared) setScreen(shared);
      });
    }

    CapacitorApp.getLaunchUrl().then((result) => {
      if (result?.url) handleIncomingUrl(result.url);
    });
    const listenerPromise = CapacitorApp.addListener("appUrlOpen", ({ url }) => handleIncomingUrl(url));
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  useEffect(() => {
    recordDailyVisit();
  }, []);

  useEffect(() => {
    trackEvent("app_open", {});
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

  // Resolves a short /c/<id> link on load. Runs after the hash-based sync
  // check above, so it only applies when the URL has no hash payload of its
  // own (the two schemes never coexist in the same link).
  useEffect(() => {
    const id = shortLinkIdFromPath();
    if (!id) return;
    let cancelled = false;
    importSharedScreenFromShortId(id).then((shared) => {
      if (cancelled || !shared) return;
      history.replaceState(null, "", "/" + location.search);
      setScreen(shared);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onRoundCompleted(() => {
        if (shouldShowAchievementsTutorial()) setShowAchievementsTutorial(true);
      }),
    [],
  );

  function dismissOnboardingTutorial() {
    markOnboardingTutorialShown();
    setShowOnboardingTutorial(false);
  }

  function dismissAchievementsTutorial() {
    markAchievementsTutorialShown();
    setShowAchievementsTutorial(false);
  }

  function handleTutorialNavigateToAchievements() {
    markAchievementsTutorialShown();
    setShowAchievementsTutorial(false);
    navigate(toAchievements(screen));
  }

  return (
    <>
      {(() => {
        switch (screen.name) {
          case "home":
            return <HomeScreen onNavigate={navigate} />;
          case "create":
            return <CreateChallengeScreen onNavigate={navigate} />;
          case "list":
            return <MyChallengesScreen onNavigate={navigate} />;
          case "play":
            return <PlayChallengeScreen challengeId={screen.challengeId} onNavigate={navigate} />;
          case "friendChallengeIntro":
            return <FriendChallengeIntroScreen challengeId={screen.challengeId} onNavigate={navigate} />;
          case "shapeChallenge":
            return <ShapeChallengeScreen onNavigate={navigate} />;
          case "dailyChallenge":
            return <DailyChallengeScreen onNavigate={navigate} />;
          case "dailyChallengeHistory":
            return <DailyChallengeHistoryScreen onNavigate={navigate} />;
          case "dailyChallengeReplay":
            return <DailyChallengeScreen onNavigate={navigate} replay={screen.entry} />;
          case "settings":
            return <SettingsScreen onNavigate={navigate} />;
          case "shop":
            return (
              <ShopScreen
                from={screen.from}
                highlightPenColorId={screen.highlightPenColorId}
                highlightPenSkinId={screen.highlightPenSkinId}
                onNavigate={navigate}
              />
            );
          case "achievements":
            return <AchievementsScreen from={screen.from} onNavigate={navigate} />;
          case "instructions":
            return (
              <InstructionsScreen
                from={screen.from}
                onNavigate={navigate}
                onStartTutorial={() => setShowOnboardingTutorial(true)}
              />
            );
          case "sharedResult":
            return <SharedResultScreen data={screen.data} onNavigate={navigate} />;
          case "sharedArtistResult":
            return <SharedArtistResultScreen data={screen.data} onNavigate={navigate} />;
          case "specialChallenge":
            return <SpecialChallengeScreen onNavigate={navigate} />;
          case "megaChallenge":
            return <MegaChallengeScreen onNavigate={navigate} />;
          case "artistPack":
            return <ArtistPackScreen packId={screen.packId} from={screen.from} replyTo={screen.replyTo} onNavigate={navigate} />;
        }
      })()}
      {showOnboardingTutorial && <OnboardingTutorialOverlay onDismiss={dismissOnboardingTutorial} />}
      {showAchievementsTutorial && !showOnboardingTutorial && (
        <AchievementsTutorialOverlay
          onNavigateToAchievements={handleTutorialNavigateToAchievements}
          onDismiss={dismissAchievementsTutorial}
        />
      )}
    </>
  );
}
