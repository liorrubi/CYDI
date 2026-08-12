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
 * Asks Play about an update once per cold start, and finishes a previously
 * downloaded one. Never throws and never blocks: callers fire-and-forget it,
 * and every failure path (web, side-load, debug build, offline, no Play
 * Services, Play API error) resolves quietly having done nothing.
 */
export async function maybePromptAppUpdate(): Promise<void> {
  // Same single platform check the rest of the app uses; on web this returns
  // before the plugin is even imported, so nothing about the site changes.
  if (!isAndroidApp()) return;

  try {
    // Dynamic import keeps the plugin out of the web bundle's main chunk.
    const { AppUpdate, AppUpdateAvailability, FlexibleUpdateInstallStatus } = await import(
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

    // Play's official dialog. Declining resolves with a non-OK code, which needs
    // no handling here - the player simply keeps playing and we ask again on a
    // future cold start.
    await AppUpdate.startFlexibleUpdate();
  } catch {
    // Not installed from Play (side-load/debug), no Play Services, offline, or
    // any Play Core error - all mean "no update flow available". Silent by
    // design: an update prompt must never produce a visible failure.
  }
}
