import { AppHeader } from "cydi";

const noop = () => {};

const nav = {
  onNavigateToAchievements: noop,
  onNavigateToShop: noop,
  onNavigateToSettings: noop,
  onNavigateToHome: noop,
};

/** The header on a top-level screen: title, subtitle and the action row. */
export const Default = () => <AppHeader title="Shape Challenge" subtitle="Trace the shape as closely as you can" {...nav} />;

/** With a back affordance, as on any screen pushed from Home. */
export const WithBack = () => <AppHeader title="Settings" onBack={noop} {...nav} />;

/** Title only - the subtitle is optional. */
export const TitleOnly = () => <AppHeader title="Achievements" onBack={noop} {...nav} />;
