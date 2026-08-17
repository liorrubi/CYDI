// Google Play FLEXIBLE in-app update, Android app only.
//
// Deliberately tiny and entirely delegated to Google Play: there is no version
// check against our own Worker/KV, no versionName comparison, and no custom UI -
// Play decides whether a newer build exists on the track this install came from,
// and Play draws its own dialog. This file only decides *when* to ask.
//
// Flow across two app launches, which is what keeps it non-blocking:
//   launch A - a newer version exists  -> ask once; if the player accepts, Play
//              downloads it in the background while they keep playing. Declining
//              costs nothing and the game continues untouched.
//   launch B - the download already finished -> install it during startup, when
//              no drawing is in progress.
// Installing is never triggered mid-session, so a flexible update can't restart
// the app out from under someone mid-drawing (the reason we don't complete the
// update from an onFlexibleUpdateStateChange listener the moment it downloads).
//
// Everything is wrapped so a non-Play install can never surface an error: on a
// side-loaded or debug APK the Play Core API reports the app as not owned/
// installed by Play and rejects, which lands in the catch below and is ignored.

import { isAndroidApp } from "./nativeShare";

/**
 * What the caller may tell the player, and nothing else. Both values come from
 * state Play actually reports - never inferred, never guessed:
 *   "downloading" - startFlexibleUpdate() resolved with code OK, i.e. the player
 *                   accepted. A decline (CANCELED) or error (FAILED) reports
 *                   nothing at all, so declining stays as silent as it ever was.
 *   "ready"       - Play's own onFlexibleUpdateStateChange reported DOWNLOADED.
 */
export type AppUpdateNotice = "downloading" | "ready";

/** The state listener is per app process, not per prompt - registering it twice
 *  would deliver every event twice (React StrictMode mounts effects twice in dev). */
let stateListenerRegistered = false;

/** Set once Play has reported DOWNLOADED, so the later "downloading" message can
 *  never overwrite the newer "ready" one when the download wins the race. */
let downloadedReported = false;

/**
 * Asks Play about an update once per cold start, and finishes a previously
 * downloaded one. Never throws and never blocks: callers fire-and-forget it,
 * and every failure path (web, side-load, debug build, offline, no Play
 * Services, Play API error) resolves quietly having done nothing.
 *
 * `onNotice` is optional and purely informational - it exists so the player gets
 * a small confirmation that accepting the update did something, because a
 * flexible update downloads silently in the background by design. It never
 * changes whether or when an update is offered.
 */
export async function maybePromptAppUpdate(onNotice?: (notice: AppUpdateNotice) => void): Promise<void> {
  // Same single platform check the rest of the app uses; on web this returns
  // before the plugin is even imported, so nothing about the site changes.
  if (!isAndroidApp()) return;

  try {
    // Dynamic import keeps the plugin out of the web bundle's main chunk.
    const { AppUpdate, AppUpdateAvailability, AppUpdateResultCode, FlexibleUpdateInstallStatus } = await import(
      "@capawesome/capacitor-app-update"
    );

    const info = await AppUpdate.getAppUpdateInfo();

    // An update accepted in an earlier session already finished downloading -
    // install it now, at startup, rather than interrupting play later.
    if (info.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
      await AppUpdate.completeFlexibleUpdate();
      return;
    }

    // `flexibleUpdateAllowed` is Play's own answer for this specific update;
    // when it's false the only option would be an immediate (blocking) update,
    // which we deliberately never do.
    if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return;
    if (!info.flexibleUpdateAllowed) return;

    // Registered BEFORE the dialog opens, deliberately. Play begins downloading the
    // moment the player accepts, and startFlexibleUpdate() only resolves after that,
    // so a small or already-cached update can reach DOWNLOADED first - a listener
    // attached afterwards would miss the one event that matters. Attaching a
    // listener starts nothing and changes nothing; it only observes.
    if (!stateListenerRegistered) {
      stateListenerRegistered = true;
      await AppUpdate.addListener("onFlexibleUpdateStateChange", (state) => {
        // Play reports this itself, and it is the only point at which "restart to
        // finish" is true. No progress is surfaced - the byte counts exist but a
        // progress bar is deliberately not shown.
        if (state.installStatus !== FlexibleUpdateInstallStatus.DOWNLOADED) return;
        downloadedReported = true;
        onNotice?.("ready");
      });
    }

    // Play's official dialog. Declining resolves with a non-OK code, which needs
    // no handling here - the player simply keeps playing and we ask again on a
    // future cold start.
    const result = await AppUpdate.startFlexibleUpdate();

    // Notification only - the update mechanism above is untouched. OK is Play's own
    // "the player accepted", so the download is now running in the background; any
    // other code (CANCELED, FAILED, NOT_AVAILABLE, NOT_ALLOWED) means nothing was
    // started and the player is told nothing.
    if (result.code !== AppUpdateResultCode.OK) return;
    // The race the early registration above exists for actually happened: the
    // download already finished, so announcing "downloading" now would replace a
    // truer message with a staler one.
    if (downloadedReported) return;
    onNotice?.("downloading");
  } catch {
    // Not installed from Play (side-load/debug), no Play Services, offline, or
    // any Play Core error - all mean "no update flow available". Silent by
    // design: an update prompt must never produce a visible failure.
  }
}
