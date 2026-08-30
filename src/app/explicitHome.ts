/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Where the explicit Home control goes.
 *
 * On the web the site is the product's home: "/" is the public SiteHome, and
 * "/play" is the game's own menu. So the header's logo, and the literal "Home"
 * buttons on the shared-result screens, should land on "/" - not on the game
 * menu they used to mean.
 *
 * This is a context rather than a prop because "Home" is wired from roughly
 * twenty-five screens, and threading a new prop through all of them would touch
 * far more production code than the change is worth. App.tsx provides the
 * override once, around everything.
 *
 * ANDROID IS UNCHANGED BY CONSTRUCTION. The default is null and App.tsx only
 * renders the provider on the web, so on native every consumer falls back to
 * exactly the handler it was already given.
 *
 * DELIBERATELY NARROW: this is the EXPLICIT Home action only. Back stays
 * contextual - a Back that happens to lead to the game menu still leads there,
 * because those call sites pass their own `onBack` and never read this.
 */
import { createContext, useContext } from "react";

export const ExplicitHomeContext = createContext<(() => void) | null>(null);

/** The web's Home destination, or null on Android (and anywhere unprovided). */
export function useExplicitHome(): (() => void) | null {
  return useContext(ExplicitHomeContext);
}
