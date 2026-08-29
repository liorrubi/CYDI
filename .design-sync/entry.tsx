/*
 * design-sync entry barrel.
 *
 * CYDI is an application, not a published component library: it has no `dist/`
 * library build and every component is an `export default`. The converter's
 * fallback entry re-exports with `export *`, which does not carry defaults, so
 * without this file every component would bundle as `undefined`.
 *
 * This barrel names the presentational components that are useful for building
 * new CYDI screens in claude.ai/design. Game machinery (DrawingCanvas,
 * ShapeOverlayCanvas, the tutorial/reward overlays) is deliberately out of
 * scope - those need live game state and render as empty cards.
 *
 * Keep in sync with `componentSrcMap` in .design-sync/config.json.
 */

import "./ds-globals";

export { default as AchievementUnlockedBanner } from "../src/components/AchievementUnlockedBanner";
export { default as AppHeader } from "../src/components/AppHeader";
export { default as AppLogo } from "../src/components/AppLogo";
export { default as ArtistPackCard } from "../src/components/ArtistPackCard";
export { default as Button } from "../src/components/Button";
export { default as ChallengeCard } from "../src/components/ChallengeCard";
export { default as ChampionBadge } from "../src/components/ChampionBadge";
export { default as ChestIcon } from "../src/components/ChestIcon";
export { default as CoinIndicator } from "../src/components/CoinIndicator";
export { default as DailyLeaderboardTable } from "../src/components/DailyLeaderboardTable";
export { default as EmptyState } from "../src/components/EmptyState";
export { default as HomeModeTabs } from "../src/components/HomeModeTabs";
export { default as LockedFeatureHint } from "../src/components/LockedFeatureHint";
export { default as PenSkinGlyph } from "../src/components/PenSkinGlyph";
export { default as ResultComparison } from "../src/components/ResultComparison";
export { default as ScoreCard } from "../src/components/ScoreCard";
export { default as ShapePreviewIcon } from "../src/components/ShapePreviewIcon";
export { default as SoundToggleButton } from "../src/components/SoundToggleButton";
export { default as StarRating } from "../src/components/StarRating";
