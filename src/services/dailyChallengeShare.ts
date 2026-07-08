// Deliberately separate from shareLink.ts/shareApi.ts (the My Challenges sharing
// mechanism): a daily challenge share has no per-share payload to encode - every
// link points at whatever challenge is live right now - so it's just a fixed,
// memorable path rather than a generated id or hash-encoded blob.
export const DAILY_CHALLENGE_SHARE_PATH = "/daily";

export function isDailyChallengeSharePath(pathname: string): boolean {
  return new RegExp(`^${DAILY_CHALLENGE_SHARE_PATH}/?$`).test(pathname);
}

export function dailyChallengeShareUrl(): string {
  return `${location.origin}${DAILY_CHALLENGE_SHARE_PATH}`;
}
