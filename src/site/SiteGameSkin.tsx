/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Wraps the browser game entry screens in 3a's visual language.
 *
 * WEB ONLY, and presentation only. It renders one element around the screen it
 * is given and imports the scoped stylesheet; it passes no props, reads no
 * store and makes no decision. Every rule it activates is a descendant of
 * `.site-game` (see styles/siteGame.css), so removing this wrapper restores the
 * screens byte for byte - which is exactly what Android gets, because App.tsx
 * never mounts it on a native platform.
 *
 * It deliberately does NOT re-implement any screen. HomeScreen and
 * ShapeChallengeScreen render the same components, in the same order, with the
 * same unlock state, progress, coins and actions as before.
 */
import type { ReactNode } from "react";
import { useCrawlableBlockTakeover } from "./crawlableBlock";
import "../styles/site.css";
import "../styles/siteGame.css";

type SiteGameSkinProps = {
  children: ReactNode;
  /** Takes the player back to the public home. */
  onExitToSite: () => void;
  /** Opens the game menu at /play, where Daily, Create, My Challenges and Shop live. */
  onGameMenu: () => void;
  /**
   * Whether to show the strip at all. False once the player is past the
   * browsing surfaces - a link out has no business under a round in progress.
   */
  showChrome: boolean;
  /** Whether the strip offers the game menu. False on the menu itself. */
  showGameMenu: boolean;
};

export default function SiteGameSkin({
  children,
  onExitToSite,
  onGameMenu,
  showChrome,
  showGameMenu,
}: SiteGameSkinProps) {
  /*
   * Several landing paths - /multiplayer-drawing-game,
   * /2-player-drawing-game-one-phone, /draw-shapes-online - are served with the
   * Worker's crawlable block AND resolve to a game screen. Without this the
   * visitor gets the real UI followed by the old standalone document, and the
   * page carries two <h1>s. See crawlableBlock.ts.
   */
  useCrawlableBlockTakeover();

  return (
    <div className="site-game">
      {children}
      {/* One quiet line back to the site, so the game is somewhere you entered
          rather than somewhere you got stuck. Not a game control: it sits
          outside every screen and changes nothing about them. */}
      {showChrome && (
        <p className="site-game-strip">
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              onExitToSite();
            }}
          >
            ← Back to CYDI home
          </a>
          {showGameMenu && (
            <>
              <span className="site-game-strip-sep" aria-hidden="true">
                ·
              </span>
              <button type="button" className="site-game-strip-menu" onClick={onGameMenu}>
                Game menu
              </button>
              <span className="site-game-strip-note">Daily Challenge, create your own, saved challenges &amp; Shop</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
