// Deliberately separate from shareLink.ts/shareApi.ts (the My Challenges sharing
// mechanism): a daily challenge share has no per-share payload to encode - every
// link points at whatever challenge is live right now - so it's just a fixed,
// memorable path rather than a generated id or hash-encoded blob.
//
// The path and its matcher live in app/webPaths.ts, the DOM-free module the Worker
// also reads; they are re-exported here so browser callers keep one import.
import { DAILY_CHALLENGE_SHARE_PATH } from "../app/webPaths";

export { DAILY_CHALLENGE_SHARE_PATH, isDailyChallengeSharePath } from "../app/webPaths";

export function dailyChallengeShareUrl(): string {
  return `${location.origin}${DAILY_CHALLENGE_SHARE_PATH}`;
}
