// Validates an incoming Android App Link (https://playcydi.com/c/{id} or
// https://playcydi.com/join/{ROOMCODE}) before
// App.tsx ever navigates or makes an API call from it. The Android intent-filter
// (see AndroidManifest.xml) is scoped to this host/path already, but that's an OS
// routing decision, not a security boundary - a crafted intent from another app
// could still hand the WebView bridge any string, so this is the real gate.
//
// Plain functions (no React, no Capacitor) so they're testable without a device -
// App.tsx's useEffect is a thin wrapper that wires these to
// CapacitorApp.getLaunchUrl()/appUrlOpen and holds the "last handled URL" ref.

export const SHORT_LINK_HOST = "playcydi.com";

// Same shape as the id CYDI's own share-link server issues (worker/index.ts's
// ID_ALPHABET/ID_LENGTH plus the legacy 6-char id window it stays backward
// compatible with) - kept in sync with App.tsx's own web-side shortLinkIdFromPath.
export const SHORT_LINK_PATH_PATTERN = /^\/c\/([A-Za-z0-9]{4,12})$/;

/** Parses and validates a raw incoming URL, returning the share id only if the
 * scheme, host, and path all match exactly - never a partial/fuzzy match. */
export function parseIncomingAppLinkId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== SHORT_LINK_HOST) return null;
  const match = url.pathname.match(SHORT_LINK_PATH_PATTERN);
  return match ? match[1] : null;
}

/**
 * Given the next incoming App Link URL and the URL most recently acted on (or
 * `null`), returns the id to act on - or `null` if the URL is invalid, or if
 * it's the exact same URL already handled. Capacitor can redeliver the
 * identical cold-start launch URL through both `getLaunchUrl()` and a
 * subsequent `appUrlOpen` event, and some app-resume paths redeliver the same
 * intent again - without this, either would import/navigate a second time.
 *
 * Callers should only advance their "last handled" tracking when this returns
 * a non-null id.
 */
export function resolveIncomingAppLinkId(rawUrl: string, previouslyHandledUrl: string | null): string | null {
  if (rawUrl === previouslyHandledUrl) return null;
  return parseIncomingAppLinkId(rawUrl);
}

// --- Play Together invites ---------------------------------------------------
// Same reasoning as the share links above: the intent-filter routes
// https://playcydi.com/join/<CODE> into the app, but that is OS routing, not
// validation, so the code is re-checked here before anything acts on it.
//
// This matters on native specifically. On the web the code can be read straight
// off `location.pathname`, but inside the Capacitor WebView `location` never
// changes for an App Link - the URL only ever arrives through getLaunchUrl() or
// an appUrlOpen event, so without this the intent-filter would open the app on
// the home screen and quietly drop the invite.

/** Upper-case only in the canonical form, but links get typed and copied in every case, so the match is case-insensitive and the result is normalised. */
export const JOIN_LINK_PATH_PATTERN = /^\/join\/([A-Za-z0-9]{6})\/?$/;

const ROOM_CODE_CHARS = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/** Parses an incoming invite URL, returning the upper-cased room code only if scheme, host, path and alphabet all match exactly. */
export function parseIncomingJoinCode(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== SHORT_LINK_HOST) return null;
  const match = url.pathname.match(JOIN_LINK_PATH_PATTERN);
  if (!match) return null;
  const code = match[1].toUpperCase();
  return ROOM_CODE_CHARS.test(code) ? code : null;
}

/** The invite-link counterpart of resolveIncomingAppLinkId, including the same redelivery guard. */
export function resolveIncomingJoinCode(rawUrl: string, previouslyHandledUrl: string | null): string | null {
  if (rawUrl === previouslyHandledUrl) return null;
  return parseIncomingJoinCode(rawUrl);
}
