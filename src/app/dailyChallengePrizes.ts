// A tiny, dependency-free file on purpose - it's imported by both the client
// and the Worker (worker/dailyChallengeDO.ts). app/constants.ts can't be
// shared the same way: it references __APP_BUILD__/__APP_BUILD_TIME__, globals
// Vite injects via `define` at build time that don't exist in the Worker's
// separate esbuild bundle, so importing it there would throw at module load.

/** Coin prize for 1st/2nd/3rd place when a Daily Challenge episode ends (index 0 = 1st place). */
export const DAILY_CHALLENGE_PRIZE_COINS = [1000, 500, 250] as const;
