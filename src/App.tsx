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
import PlayTogetherScreen from "./screens/PlayTogetherScreen";
import { toAchievements, toDailyChallenge, toFriendChallengeIntro, toHome, toPlayTogether, toShapeChallenge, toSharedArtistResult, toSharedResult } from "./app/routes";
import { resolveIncomingAppLinkId, resolveIncomingJoinCode, SHORT_LINK_PATH_PATTERN } from "./app/appLinks";
import { recordDailyVisit } from "./services/dailyStreakStore";
import { trackEvent } from "./services/analytics";
import {
  armTutorialReplay,
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
import type { LandingPage } from "./seo/landingPages";
import { initializeNativeAds } from "./services/ads/nativeAdsSetup";
import { maybePromptAppUpdate } from "./services/appUpdate";
import { isRoomCode } from "./multiplayer/protocol";
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

/** Matches the Play Together invite path, `/join/<CODE>`, and returns the code. Case-insensitive on the way in; codes themselves are always upper-case. */
export function playTogetherJoinCode(pathname: string): string | null {
  const match = pathname.match(/^\/join\/([A-Za-z0-9]{6})\/?$/);
  if (!match) return null;
  const code = match[1].toUpperCase();
  return isRoomCode(code) ? code : null;
}

/** A /c/<id> link that can't be resolved - expired, deleted, or simply offline. Without
 * saying so the player just lands on the home screen and never learns their friend's link
 * failed. */
const SHARED_LINK_UNAVAILABLE = "That challenge link isn't available - ask your friend for a new one.";

/** True while the URL still carries a challenge payload. A decodable one is consumed and
 * stripped from the URL by the import above, so anything left here failed to decode. */
function hasUndecodableChallengeHash(): boolean {
  return location.hash.startsWith("#c.");
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

type AppProps = {
  /** Web-only: set by main.tsx when the URL is an SEO landing path, so the page
   * opens on the challenge it describes instead of the home screen. Always
   * undefined on Android (and on every non-landing web path), where every branch
   * below is skipped and behaviour is unchanged. */
  landing?: LandingPage;
};

export default function App({ landing }: AppProps) {
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
    // Play Together invite: /join/<CODE>. A dedicated path rather than the /c/
    // share namespace, so an invite link reads as what it is. The code is
    // consumed into screen state and stripped, exactly like the share paths
    // above - re-opening the app must not silently rejoin an old room.
    const joinCode = playTogetherJoinCode(location.pathname);
    if (joinCode) {
      history.replaceState(null, "", "/" + location.search);
      return toPlayTogether(joinCode);
    }
    // Landing pages keep their URL (unlike the share paths above) - it is the
    // canonical, indexed address of this page, not a payload to consume.
    if (landing) return toShapeChallenge();
    return { name: "home" };
  });
  const [showAchievementsTutorial, setShowAchievementsTutorial] = useState(() => shouldShowAchievementsTutorial());
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(() => shouldShowOnboardingTutorial());
  /** Transient in-app update notice (Android only); null whenever there is nothing to say. */
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  /** Transient notice for a share link that could not be opened. */
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  /**
   * True while a /c/<id> link is still being resolved. Unlike a hash link - which carries its
   * own payload and is decoded synchronously before the first render - a short link needs a
   * round trip, so the app renders home first. Without this the very first thing a new player
   * sees when they open a friend's link is the home screen's "Start here" spotlight, which
   * then vanishes when the challenge loads. On native the launch URL is itself async, so the
   * check starts pending there and clears as soon as Capacitor answers.
   */
  const [sharedLinkPending, setSharedLinkPending] = useState(
    () => shortLinkIdFromPath() !== null || Capacitor.isNativePlatform(),
  );
  /**
   * Narrower than the flag above: true only once a link is actually being fetched, and it
   * replaces the whole UI with a neutral notice. The home screen must not be reachable in
   * that window - a resolve takes long enough on a phone connection for someone to start
   * tapping a card and be yanked into a challenge mid-tap. The broader flag still covers
   * native's launch-URL check, which is too short to be worth blanking the screen for.
   */
  const [resolvingSharedLink, setResolvingSharedLink] = useState(() => shortLinkIdFromPath() !== null);

  // Screen navigation is plain React state, not browser history, so there's
  // nothing for the Android hardware back button to pop by default (it would
  // otherwise exit the app immediately from any screen). This stack mirrors
  // in-app navigation so back-button presses retrace it instead.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const screenHistoryRef = useRef<Screen[]>([]);
  const lastHandledAppLinkUrlRef = useRef<string | null>(null);
  // A landing page's deep link applies to the first view only. Once the player
  // navigates anywhere themselves, coming back to Shape Challenge shows the map
  // like it always does, instead of dropping them into the same shape again.
  const landingShapeRef = useRef(landing?.shape);

  function navigate(next: Screen) {
    landingShapeRef.current = undefined;
    screenHistoryRef.current.push(screenRef.current);
    setScreen(next);
  }

  // Fail-closed ad bootstrap (consent -> SDK init -> adapter registration), a
  // no-op on web - see nativeAdsSetup.ts for the full sequencing/consent contract.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    initializeNativeAds();
  }, []);

  // Google Play flexible in-app update - asked once per cold start, Android app
  // only, and a silent no-op anywhere Play can't answer. See appUpdate.ts.
  //
  // The notice exists only because a flexible update downloads silently: accepting
  // Play's dialog otherwise looks like nothing happened. Both messages are driven
  // by state Play reports, so a declined or failed update still says nothing.
  useEffect(() => {
    let timer = 0;
    maybePromptAppUpdate((notice) => {
      setUpdateNotice(
        notice === "downloading" ? "Downloading update…" : "Update ready - restart the app to finish",
      );
      // Transient: it never needs dismissing and never waits for input. The
      // "ready" message lingers longer because it asks something of the player.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setUpdateNotice(null), notice === "downloading" ? 5000 : 10000);
    });
    return () => window.clearTimeout(timer);
  }, []);

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

    /** Returns whether this URL was taken on - the caller uses that to stop waiting. */
    function handleIncomingUrl(rawUrl: string): boolean {
      // A Play Together invite. Checked first because it needs no network round
      // trip: the room code is in the URL, so the join screen can open straight
      // away rather than through the share-link resolve path below.
      const joinCode = resolveIncomingJoinCode(rawUrl, lastHandledAppLinkUrlRef.current);
      if (joinCode) {
        lastHandledAppLinkUrlRef.current = rawUrl;
        setScreen(toPlayTogether(joinCode));
        setSharedLinkPending(false);
        return true;
      }

      const id = resolveIncomingAppLinkId(rawUrl, lastHandledAppLinkUrlRef.current);
      if (!id) return false;
      lastHandledAppLinkUrlRef.current = rawUrl;
      setResolvingSharedLink(true);
      importSharedScreenFromShortId(id)
        .then((shared) => {
          if (shared) setScreen(shared);
          else setLinkNotice(SHARED_LINK_UNAVAILABLE);
        })
        .catch(() => setLinkNotice(SHARED_LINK_UNAVAILABLE))
        .finally(() => {
          setSharedLinkPending(false);
          setResolvingSharedLink(false);
        });
      return true;
    }

    CapacitorApp.getLaunchUrl()
      .then((result) => {
        // No launch URL, or one this app doesn't own: nothing is coming, stop holding
        // the onboarding spotlight back.
        if (!result?.url || !handleIncomingUrl(result.url)) setSharedLinkPending(false);
      })
      .catch(() => setSharedLinkPending(false));
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
      if (!shared) {
        if (hasUndecodableChallengeHash()) setLinkNotice(SHARED_LINK_UNAVAILABLE);
        return;
      }
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
    importSharedScreenFromShortId(id)
      .then((shared) => {
        if (cancelled) return;
        if (!shared) {
          setLinkNotice(SHARED_LINK_UNAVAILABLE);
          return;
        }
        history.replaceState(null, "", "/" + location.search);
        setScreen(shared);
      })
      .catch(() => {
        if (!cancelled) setLinkNotice(SHARED_LINK_UNAVAILABLE);
      })
      .finally(() => {
        if (cancelled) return;
        setSharedLinkPending(false);
        setResolvingSharedLink(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hasUndecodableChallengeHash()) setLinkNotice(SHARED_LINK_UNAVAILABLE);
  }, []);

  useEffect(() => {
    if (!linkNotice) return;
    const timer = window.setTimeout(() => setLinkNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [linkNotice]);

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

  /** The "Start here" spotlight was accepted - drop straight into Shape Challenge. */
  function startOnboardingTutorial() {
    markOnboardingTutorialShown();
    setShowOnboardingTutorial(false);
    navigate(toShapeChallenge());
  }

  /** Instructions -> Start Tutorial: re-arm one coached round and show the Start here spotlight again. */
  function handleStartTutorialFromInstructions() {
    armTutorialReplay();
    setShowOnboardingTutorial(true);
    navigate(toHome());
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
        // A share link still being fetched owns the screen. Rendering home here instead
        // would put a full, tappable menu in front of someone who is about to be moved to
        // a challenge - long enough on a phone connection to start a tap and lose it.
        if (resolvingSharedLink) {
          return (
            <div className="screen">
              <p className="status-text" role="status">
                Opening challenge…
              </p>
            </div>
          );
        }
        switch (screen.name) {
          case "home":
            return <HomeScreen onNavigate={navigate} />;
          case "create":
            return <CreateChallengeScreen onNavigate={navigate} />;
          case "list":
            return <MyChallengesScreen onNavigate={navigate} />;
          case "play":
            return <PlayChallengeScreen challengeId={screen.challengeId} from={screen.from} onNavigate={navigate} />;
          case "friendChallengeIntro":
            return <FriendChallengeIntroScreen challengeId={screen.challengeId} onNavigate={navigate} />;
          case "shapeChallenge":
            return <ShapeChallengeScreen onNavigate={navigate} initialShape={landingShapeRef.current} />;
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
                onStartTutorial={handleStartTutorialFromInstructions}
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
          case "playTogether":
            return <PlayTogetherScreen onNavigate={navigate} initialJoinCode={screen.joinCode} />;
        }
      })()}
      {/* Spotlights the home screen's Shape Challenge card, so it only renders where that card exists. */}
      {showOnboardingTutorial && !sharedLinkPending && !resolvingSharedLink && screen.name === "home" && (
        <OnboardingTutorialOverlay onStart={startOnboardingTutorial} onDismiss={dismissOnboardingTutorial} />
      )}
      {showAchievementsTutorial && !showOnboardingTutorial && (
        <AchievementsTutorialOverlay
          onNavigateToAchievements={handleTutorialNavigateToAchievements}
          onDismiss={dismissAchievementsTutorial}
        />
      )}
      {/* Non-blocking: pointer-events are off in CSS, so it can never intercept a
          tap on the game or the navigation underneath it. role="status" announces
          it once without stealing focus. */}
      {(updateNotice || linkNotice) && (
        <div className="app-update-toast" role="status">
          {updateNotice ?? linkNotice}
        </div>
      )}
    </>
  );
}
