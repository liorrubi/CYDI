import { Capacitor } from "@capacitor/core";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

// `url` is optional so a caller that has already embedded the link directly in
// `text` (e.g. "message\n\nhttps://...") can omit it - passing both would risk
// some share targets appending the url a second time after `text`. When `url`
// is omitted, the clipboard fallback copies `text` verbatim instead, so both
// paths always produce the exact same content.
export type ShareData = { title: string; text: string; url?: string };

/** The Play Store listing for this app - id kept in sync with `appId` in capacitor.config.ts and `applicationId` in android/app/build.gradle. */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.playcydi.cydi";

/** The single platform check the whole sharing layer shares - true only inside the Android app, never on the website (where `getPlatform()` is "web"). */
export function isAndroidApp(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * Picks the destination for shares whose link is just "come play CYDI" and
 * carries no payload of its own (the header button, the Champion badge, the
 * daily challenge). Inside the Android app those point at the Play Store
 * listing so a recipient lands on the install page - and because Capacitor
 * serves the app from the virtual https://localhost origin, a `location.origin`
 * link would have been unreachable there anyway. On web it returns `webUrl`
 * untouched, so the site keeps sharing playcydi.com exactly as before.
 *
 * Shares that carry a real payload link (a challenge, a result) must NOT go
 * through here - their link IS the content and is already built against the
 * production origin by shareApi/shareLink.
 */
export function genericShareUrl(webUrl: string): string {
  return isAndroidApp() ? PLAY_STORE_URL : webUrl;
}

/**
 * Android-only: opens the real OS Sharesheet (WhatsApp/Gmail/Messages/copy
 * link/...) through Capacitor's Share plugin. The Capacitor WebView has no
 * `navigator.share`, so on the app every share would otherwise silently
 * degrade to a clipboard copy.
 *
 * Returns null on any other platform (web included), and also when the sheet
 * failed for a reason other than the user dismissing it - both cases fall
 * through to the unchanged web path below, so the clipboard fallback still
 * covers a genuine failure inside the app.
 */
async function shareViaAndroidSheet(data: ShareData): Promise<ShareOutcome | null> {
  if (!isAndroidApp()) return null;
  // Dynamically imported so the plugin never lands in the web bundle's main chunk.
  const { Share } = await import("@capacitor/share");
  try {
    await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title });
    return "shared";
  } catch (error) {
    // The plugin rejects on a dismissed sheet with the literal message "Share
    // canceled" (SharePlugin.java); anything else is a real failure worth
    // falling back for, rather than silently swallowing.
    const message = error instanceof Error ? error.message : String(error);
    return /cancel/i.test(message) ? "cancelled" : null;
  }
}

/** Tries the OS share sheet (WhatsApp/Email/Messages/Telegram/etc. wherever supported), falling back to a clipboard copy on unsupported browsers or non-cancel failures. */
export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  // Android app only; on web this is a no-op that returns null immediately,
  // before the plugin is even loaded, leaving the path below untouched.
  const androidOutcome = await shareViaAndroidSheet(data);
  if (androidOutcome) return androidOutcome;

  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(data.url ?? data.text);
    return "copied";
  } catch {
    return "failed";
  }
}
