/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import AchievementsTutorialOverlay from "./components/AchievementsTutorialOverlay";
import ModeIntroOverlay from "./components/ModeIntroOverlay";
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
import PassPlayScreen from "./screens/PassPlayScreen";
import PlayTogetherScreen from "./screens/PlayTogetherScreen";
/**
 * The public-site surfaces are LAZY, and that is a shipping requirement rather
 * than a page-weight tweak: everything under src/site/ - the components,
 * site.css and the Figtree webfont SiteShell attaches at runtime - must never
 * load, parse or apply inside the Android WebView. Capacitor copies the whole
 * dist/ into the APK, so the chunk file is present there; splitting it means
 * nothing ever fetches it, and site.css is no longer part of the stylesheet the
 * app itself loads. main.tsx starts the same import in parallel with this
 * module on the paths that will render it, so the web pays no extra round trip.
 */
const SiteHome = lazy(() => import("./site/SiteHome"));
const SeoPracticePage = lazy(() => import("./site/SeoPracticePage"));
/**
 * The 3a skin for the browser game entry screens. Lazy for the same reason as
 * the pages above - it must not reach the Android WebView - and mounted only on
 * the web, so on native the screens render with no wrapper at all.
 */
const SiteGameSkin = lazy(() => import("./site/SiteGameSkin"));

/**
 * Held while the site chunk arrives. Styled inline, deliberately: the site
 * stylesheet is inside the chunk being waited for, so anything class-based
 * would flash white on the dark stage before it lands.
 */
function SiteChunkFallback() {
  return <div style={{ minHeight: "100dvh", background: "#14151f" }} aria-busy="true" />;
}
import { toAchievements, toDailyChallenge, toFriendChallengeIntro, toHome, toPassPlay,
  toPlayTogether, toSeoLanding, toShapeChallenge, toSharedArtistResult, toSharedResult,
  toSiteHome } from "./app/routes";
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
import { markModeIntroShown, resetModeIntro, shouldShowModeIntro } from "./services/modeIntroStore";
import { runNavigationGuard } from "./app/navigationGuard";
import { ExplicitHomeContext } from "./app/explicitHome";
import AppSkin from "./app/AppSkin";
import { resetMultiplayerTutorials } from "./services/multiplayerTutorialStore";
import { getChallenge, updateChallenge } from "./services/challengeStorage";
import { decodeArtistResultHash, decodeChallengeHash, decodeResultHash, type DecodedSharedChallenge } from "./services/shareLink";
import { fetchSharedById } from "./services/shareApi";
import { isDailyChallengeSharePath } from "./services/dailyChallengeShare";
import type { LandingPage } from "./seo/landingPages";
import { LANDING_CTA_HASH, landingCtaMode } from "./seo/landingCta";
import { initializeNativeAds } from "./services/ads/nativeAdsSetup";
import { maybePromptAppUpdate } from "./services/appUpdate";
import { isRoomCode } from "./multiplayer/protocol";
import { getShapeById } from "./content/contentRepository";
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

/**
 * Where the web serves the GAME. "/" is the public site (art direction 3a); the
 * game's own home screen lives here, so it is a real, shareable address rather
 * than a mode of "/". Android never sees either: Capacitor loads index.html
 * from inside the APK at "/", and `Capacitor.isNativePlatform()` gates every branch below.
 */
export const PLAY_PATH = "/play";

/**
 * Classic gameplay, entered straight from the site's primary CTA. It gets its
 * own address rather than sharing /play so a reload, a Back press and a shared
 * link all land where the button said they would. /play stays what it was: the
 * game's menu screen, and still the only route to Daily Challenge, Create
 * Challenge, My Challenges and the Shop.
 */
export const CLASSIC_PATH = "/play/classic";

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "");
}

function isPlayPath(pathname: string): boolean {
  return normalizePath(pathname) === PLAY_PATH;
}

function isClassicPath(pathname: string): boolean {
  return normalizePath(pathname) === CLASSIC_PATH;
}

/** True on the web, at the site root - the only path that opens the marketing home. */
function isSiteRootPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === "";
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

/**
 * Which screens the web dresses in 3a (see site/SiteGameSkin.tsx).
 *
 * Deliberately an INVERSION, not a list. The site surfaces render their own
 * shell; everything else is the game, and on the web the game should look like
 * one product from the home page to the last result screen. An allowlist meant
 * every new screen - and every nested state and overlay inside an existing one -
 * silently defaulted to the old light presentation, which is exactly the drift
 * this replaces. Android is unaffected: App.tsx never mounts the skin there.
 */
function isSkinnedGameScreen(screen: Screen): boolean {
  return !isSiteScreen(screen);
}

/** The web-only public-site surfaces, which no in-game overlay belongs on. */
function isSiteScreen(screen: Screen): boolean {
  return screen.name === "siteHome" || screen.name === "seoLanding";
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
    if (landing?.mode === "playTogether") return toPlayTogether();
    if (landing?.mode === "passPlay") return toPassPlay();
    // A shape-focused landing path now opens the 4a presentation instead of
    // dropping straight onto the canvas. The practice flow itself is unchanged:
    // the CTA on that page hands this same descriptor to Shape Challenge, which
    // still owns unlock checks, scoring and progression neutrality.
    if (landing?.shape && getShapeById(landing.shape.shapeId)) return toSeoLanding();
    if (landing) return toShapeChallenge();
    // Web only, and only at the site root: the public marketing home. Android
    // (and /play) fall through to the game's own home screen, unchanged.
    if (!Capacitor.isNativePlatform() && isSiteRootPath(location.pathname)) return toSiteHome();
    // Classic has its own address; /play and everything else still open the
    // game's menu screen, exactly as before.
    if (!Capacitor.isNativePlatform() && isClassicPath(location.pathname)) return toShapeChallenge();
    return { name: "home" };
  });
  const [showAchievementsTutorial, setShowAchievementsTutorial] = useState(() => shouldShowAchievementsTutorial());
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(() => shouldShowOnboardingTutorial());
  const [showModeIntro, setShowModeIntro] = useState(() => shouldShowModeIntro());
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

  /**
   * True while the browser is actually sitting on a dedicated MODE url
   * (/multiplayer-drawing-game, /2-player-drawing-game-one-phone) - not merely
   * booted from one. `landing` is fixed at boot, so the path is checked too:
   * once enterGame has pushed /play or /play/classic this is false again.
   */
  function onModeLandingPath(): boolean {
    if (Capacitor.isNativePlatform() || !landing?.mode) return false;
    return normalizePath(location.pathname) === normalizePath(landing.path);
  }

  function navigate(next: Screen) {
    /*
     * Leaving a mode from its own URL means going back to the public home, and
     * the address has to move with the screen. Without this the game's own
     * "go home" renders the /play menu while the URL still reads
     * /multiplayer-drawing-game - a screen/URL mismatch a reload would undo.
     *
     * Deliberately narrow: only a navigation to the game's home screen, only on
     * the web, and only while the browser is on that mode's URL. /play stays a
     * separate destination reached explicitly, and every other navigation -
     * including Back inside a mode, and Back during a live round - is untouched.
     */
    if (next.name === "home" && onModeLandingPath()) {
      exitToSite();
      return;
    }
    /*
     * Same principle one level down: leaving Classic for the game menu has to
     * move the address off /play/classic, or a reload would drop the player
     * back into Classic from the menu they just navigated to.
     */
    if (next.name === "home" && !Capacitor.isNativePlatform() && isClassicPath(location.pathname)) {
      enterGame(toHome(), PLAY_PATH);
      return;
    }
    /*
     * And the mirror of that rule: arriving at Classic has to claim
     * /play/classic, whatever the address happened to be.
     *
     * The site's own Classic entries already call enterGame with this path, but
     * a navigation from inside the game did not - so reaching Classic from the
     * Shop's "Play Classic" link, or from the header shortcut, while the
     * address still read /multiplayer-drawing-game left the screen and the URL
     * disagreeing, and a reload would throw the player back to Multiplayer.
     * Screen and URL agree in both directions now.
     */
    if (next.name === "shapeChallenge" && !Capacitor.isNativePlatform() && !isClassicPath(location.pathname)) {
      enterGame(next, CLASSIC_PATH);
      return;
    }
    landingShapeRef.current = undefined;
    screenHistoryRef.current.push(screenRef.current);
    setScreen(next);
  }

  /**
   * Site -> game. Pushes the real /play address so the browser Back button
   * returns to the site and a reload stays in the game; the game's own screens
   * are still plain React state, exactly as before.
   */
  function enterGame(next: Screen = toHome(), path: string = PLAY_PATH) {
    if (!Capacitor.isNativePlatform() && normalizePath(location.pathname) !== path) {
      history.pushState(null, "", path + location.search);
    }
    navigate(next);
  }

  /** Game -> site. The mirror of enterGame, so Back keeps working both ways. */
  function exitToSite() {
    if (!Capacitor.isNativePlatform() && !isSiteRootPath(location.pathname)) {
      history.pushState(null, "", "/" + location.search);
    }
    screenHistoryRef.current = [];
    navigate(toSiteHome());
  }

  /**
   * The 4a page's "Practice this shape". Deliberately NOT `navigate()`: that
   * clears the landing shape, and this is the one navigation that must keep it,
   * because it is what tells ShapeChallengeScreen which shape the page promised.
   * Nothing else about the practice round changes - the screen still re-checks
   * unlock state and shapeRoundOutcome.ts still decides what a round persists.
   */
  function startLandingPractice() {
    screenHistoryRef.current.push(screenRef.current);
    setScreen(toShapeChallenge());
  }

  /**
   * Back/Forward across the web addresses this app rewrites: "/" (the public
   * site), "/play" (the game menu) and "/play/classic". `enterGame` and
   * `exitToSite` push those, so without this the URL and the rendered screen
   * drift apart the moment someone presses Back.
   *
   * A landing path is included too, but only to return TO it: the explicit Home
   * control can now push "/" from a practice round, so Back has to be able to
   * put the page it came from back on screen. Landing paths are still never
   * rewritten by in-app navigation - they stay the page's canonical address.
   *
   * Everything else in the game remains plain React state with no history entry
   * of its own, exactly as before, and none of this runs on Android.
   */
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    function syncScreenToPath() {
      const path = normalizePath(location.pathname);
      if (isSiteRootPath(path)) {
        screenHistoryRef.current = [];
        setScreen(toSiteHome());
      } else if (isClassicPath(path)) {
        setScreen(toShapeChallenge());
      } else if (isPlayPath(path)) {
        setScreen(toHome());
      } else if (landing && normalizePath(landing.path) === path) {
        // Back onto the landing page it started from. A shape-focused one shows
        // its 4a presentation again; the mode pages keep opening their mode.
        if (landing.mode === "playTogether") setScreen(toPlayTogether());
        else if (landing.mode === "passPlay") setScreen(toPassPlay());
        else if (landing.shape && getShapeById(landing.shape.shapeId)) setScreen(toSeoLanding());
        else setScreen(toShapeChallenge());
      }
    }
    window.addEventListener("popstate", syncScreenToPath);
    return () => window.removeEventListener("popstate", syncScreenToPath);
  }, [landing]);

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
      // A screen in front may need to ask something first - a live multiplayer
      // game asks before dropping the player out of the room. If it takes the
      // press, back does nothing else.
      if (runNavigationGuard()) return;
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
      // The landing page's own CTA (see seo/landingCta.ts). Handled before the
      // share decoders, which have nothing to say about this fragment.
      if (location.hash === LANDING_CTA_HASH) {
        // Consumed, so pressing the button a SECOND time is a fragment change
        // again rather than a silent no-op that leaves the visitor on home.
        history.replaceState(null, "", location.pathname + location.search);
        const mode = landingCtaMode(landing, screenRef.current.name);
        if (mode === "playTogether") setScreen(toPlayTogether());
        else if (mode === "passPlay") setScreen(toPassPlay());
        return;
      }
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
  }, [landing]);

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

  /**
   * Instructions -> Start Tutorial: re-arm everything first-run, not just the
   * Classic round.
   *
   * There are five separate first-run explanations now (modes, Pass & Play,
   * host, guest, and the in-round coach marks for each), and a replay button
   * that silently skipped four of them would be the wrong kind of surprise for
   * the person who pressed it precisely because they wanted the tour again.
   */
  function handleStartTutorialFromInstructions() {
    armTutorialReplay();
    resetModeIntro();
    resetMultiplayerTutorials();
    setShowModeIntro(true);
    setShowOnboardingTutorial(true);
    navigate(toHome());
  }

  function dismissModeIntro() {
    markModeIntroShown();
    setShowModeIntro(false);
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

  const rendered = (
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
          case "siteHome":
            return (
              <Suspense fallback={<SiteChunkFallback />}>
                <SiteHome
                  onPlayClassic={() => enterGame(toShapeChallenge(), CLASSIC_PATH)}
                  onOpenGameMenu={() => enterGame(toHome(), PLAY_PATH)}
                  onDailyChallenge={() => enterGame(toDailyChallenge(), PLAY_PATH)}
                />
              </Suspense>
            );
          case "seoLanding": {
            // Guarded at construction (the initializer only returns this screen
            // for a landing whose shape resolves), so this is belt and braces.
            const landingShape = landing?.shape && getShapeById(landing.shape.shapeId);
            if (!landingShape) return <HomeScreen onNavigate={navigate} />;
            return (
              <Suspense fallback={<SiteChunkFallback />}>
                <SeoPracticePage
                  shape={landingShape}
                  onPractice={startLandingPractice}
                  onPlay={() => enterGame(toShapeChallenge(), CLASSIC_PATH)}
                />
              </Suspense>
            );
          }
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
          case "passPlay":
            return <PassPlayScreen onNavigate={navigate} />;
          case "playTogether":
            return <PlayTogetherScreen onNavigate={navigate} initialJoinCode={screen.joinCode} />;
        }
      })()}
      {/* Which game, before which card: the mode card comes first and the Shape
          Challenge spotlight waits for it, so a new player is never asked to
          read two things at once. */}
      {showModeIntro && !sharedLinkPending && !resolvingSharedLink && screen.name === "home" && (
        <ModeIntroOverlay onDismiss={dismissModeIntro} />
      )}
      {/* Spotlights the home screen's Shape Challenge card, so it only renders where that card exists. */}
      {showOnboardingTutorial && !showModeIntro && !sharedLinkPending && !resolvingSharedLink && screen.name === "home" && (
        <OnboardingTutorialOverlay onStart={startOnboardingTutorial} onDismiss={dismissOnboardingTutorial} />
      )}
      {showAchievementsTutorial && !showOnboardingTutorial && !isSiteScreen(screen) && (
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

  // The skin wraps EVERYTHING the screen renders, overlays included - a tutorial
  // card sitting outside it would be a light card on a dark stage, which is the
  // exact discontinuity this is here to remove. Android and every unskinned
  // screen get `rendered` untouched.
  const body =
    Capacitor.isNativePlatform() || !isSkinnedGameScreen(screen) ? (
      rendered
    ) : (
      <Suspense fallback={<SiteChunkFallback />}>
        <SiteGameSkin
          onExitToSite={exitToSite}
          onGameMenu={() => enterGame(toHome(), PLAY_PATH)}
          /* The strip belongs on the browsing surfaces, not under a live round. */
          showChrome={screen.name === "home" || screen.name === "shapeChallenge"}
          /* On the menu itself, a link to the menu would say nothing. */
          showGameMenu={screen.name !== "home"}
        >
          {rendered}
        </SiteGameSkin>
      </Suspense>
    );

  // On the web, the explicit Home control means the public site at "/" - the
  // header logo and the shared-result screens' "Home" buttons read this. Back
  // is untouched: it stays whatever each screen already passes as `onBack`.
  // Not rendered at all on Android, so every consumer there falls back to the
  // game home screen exactly as before.
  /*
   * Android gets the app-shell wrapper: one class that carries the visual
   * refresh (src/styles/appShell.css) and renders no chrome of its own, so no
   * layout, flow or tap target changes. The web never mounts it, which is what
   * keeps the refresh out of the website entirely.
   */
  if (Capacitor.isNativePlatform()) return <AppSkin>{body}</AppSkin>;
  return <ExplicitHomeContext.Provider value={exitToSite}>{body}</ExplicitHomeContext.Provider>;
}
