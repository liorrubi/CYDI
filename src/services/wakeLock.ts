/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Keeps the screen awake while a player is in a Play Together room.
//
// Play Together is the one mode where you can sit and watch for 20 seconds
// without touching anything - waiting out other players' drawing time - which
// is exactly long enough for a phone to dim and lock. Coming back from a
// locked screen costs a round.
//
// ONE implementation for both platforms. The Screen Wake Lock API was measured
// working inside CYDI's Android WebView (acquired and released cleanly on the
// Mi 8), so no Capacitor plugin is needed - which is the smallest safe change,
// and avoids a second code path that only one platform ever exercises.
//
// IMPORTANT: this is comfort, never correctness. A wake lock can be refused,
// revoked by the OS at any moment, or absent entirely. Everything that makes
// the game survive a dark screen - server-authoritative deadlines, full
// snapshots on resume, reconnect - is unchanged and does the real work. This
// only reduces how often that machinery is needed.

/** The subset of the API this module uses; typed locally because lib.dom does not ship it everywhere. */
type WakeLockSentinelLike = { released: boolean; release: () => Promise<void>; addEventListener: (type: "release", fn: () => void) => void };
type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
  return api ?? null;
}

export function isWakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

/**
 * Holds a screen wake lock until released.
 *
 * Re-acquires on returning to the foreground, because the OS drops the lock
 * whenever the page is hidden and does NOT restore it - without that, the lock
 * silently stops working the first time a player checks a notification.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private released = false;

  static async acquire(): Promise<ScreenWakeLock> {
    const lock = new ScreenWakeLock();
    await lock.request();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", lock.handleVisibilityChange);
    }
    return lock;
  }

  private async request(): Promise<void> {
    const api = wakeLockApi();
    if (!api || this.released || this.sentinel) return;
    try {
      const sentinel = await api.request("screen");
      // A lock released by the OS (screen off, tab hidden, battery saver) must
      // not leave a stale sentinel behind, or the re-acquire below is skipped.
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      if (this.released) {
        // Released while the request was in flight.
        await sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
    } catch {
      // Refused (unsupported, battery saver, no user activation). Silent by
      // design - the game does not depend on it.
    }
  }

  private handleVisibilityChange = (): void => {
    if (this.released) return;
    if (document.visibilityState === "visible" && !this.sentinel) void this.request();
  };

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  async release(): Promise<void> {
    this.released = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) await sentinel.release().catch(() => {});
  }
}
