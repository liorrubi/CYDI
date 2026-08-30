/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The chrome shared by every public-site surface: the dark stage, the top nav
 * and the footer (art directions 3a and 4a).
 *
 * WEB ONLY. App.tsx renders nothing under src/site/ when Capacitor reports a
 * native platform, so this module - and the stylesheet it imports - never runs
 * in the Android WebView.
 *
 * The dark treatment is scoped to `.site-root` (see site.css); the root theme
 * attribute is never touched, so walking into the game restores whatever theme
 * the player chose.
 *
 * H1 OWNERSHIP: for the paths it serves, the Worker appends its own crawlable
 * block after #root (worker/seoPages.ts), and that block carries the page's
 * <h1> for anything that does not run JavaScript. Every surface built on this
 * shell renders its own <h1>, so the shell removes that block on mount. The
 * result is exactly one <h1> either way - the Worker's when the page is not
 * rendered, this one when it is - and they say the same thing, because both are
 * built from publicFacts / siteContent.
 */
import type { ReactNode } from "react";
import AppLogo from "../components/AppLogo";
import { SITE_NAV } from "../content/siteContent";
import { useCrawlableBlockTakeover } from "./crawlableBlock";
import "../styles/site.css";

/**
 * Figtree is the approved display face. It is now SELF-HOSTED: the @font-face
 * rules live in site.css, which only this shell imports, so the files are still
 * web-only and never reach the APK - and the site no longer contacts Google to
 * render text. See the licence note at the top of src/styles/site.css.
 */
export type SiteNavKey = "classic" | "passPlay" | "multiplayer" | null;

type SiteShellProps = {
  children: ReactNode;
  /** Which nav entry carries the active dot. */
  active?: SiteNavKey;
  /**
   * Starts Classic. Used by the "Play now" CTA and by the Classic nav item -
   * both land on /play/classic, one as navigation and one as the primary action.
   */
  onPlay: () => void;
  /** Rendered at the right of the nav on the home page only. */
  navExtra?: ReactNode;
  /** Optional right-hand meta line in the footer (e.g. the catalog count). */
  footerMeta?: ReactNode;
};

export default function SiteShell({ children, active = null, onPlay, navExtra, footerMeta }: SiteShellProps) {
  useCrawlableBlockTakeover();

  return (
    <div className="site-root">
      {/* First thing TAB reaches, so a keyboard or screen-reader user can jump
          the nav instead of walking it on every page (WCAG 2.4.1). */}
      <a className="site-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-nav">
        <a className="site-brand" href="/" aria-label="CYDI home">
          <span className="site-brand-mark" aria-hidden="true">
            <AppLogo size={30} />
          </span>
          <span className="site-brand-name">CYDI</span>
        </a>

        <nav className="site-nav-links" aria-label="Game modes">
          {SITE_NAV.map((item) => {
            const isActive = item.mode === active;
            /*
             * Real links to real URLs, so middle-click, right-click and
             * "open in new tab" all behave. Classic is the one destination the
             * app already owns as a route, so a plain click is handled in-app
             * rather than reloading the page; the other two are separate
             * documents and navigate normally.
             */
            const sameApp = item.mode === "classic";
            return (
              <a
                key={item.href}
                className={[
                  "site-nav-link",
                  isActive ? "site-nav-link-active" : null,
                  `site-nav-link-${item.mode}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={
                  sameApp
                    ? (event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        onPlay();
                      }
                    : undefined
                }
              >
                {item.label}
                {isActive && <span className="site-nav-dot" aria-hidden="true" />}
              </a>
            );
          })}
        </nav>

        {navExtra && <div className="site-nav-actions">{navExtra}</div>}
      </header>

      {/* tabIndex={-1} so the skip link can actually move focus here; the CSS
          suppresses the ring, because the landmark is a destination, not a
          control. Every site route renders exactly one of these. */}
      <main className="site-main" id="main-content" tabIndex={-1}>
        {children}
      </main>

      <footer className="site-footer">
        <ul className="site-footer-links">
          <li>
            <a className="site-footer-link" href="/how-to-play">
              How to play
            </a>
          </li>
          <li>
            <a className="site-footer-link" href="/about">
              About
            </a>
          </li>
          <li>
            <a className="site-footer-link" href="/contact">
              Contact
            </a>
          </li>
          <li>
            <a className="site-footer-link" href="/privacy">
              Privacy
            </a>
          </li>
          <li>
            <a className="site-footer-link" href="/terms">
              Terms
            </a>
          </li>
          <li>
            <a className="site-footer-link" href="/accessibility">
              Accessibility
            </a>
          </li>
        </ul>
        {footerMeta && <span className="site-footer-meta">{footerMeta}</span>}
        <p className="site-footer-copy">© 2026 Lior Rubinovich. All rights reserved.</p>
      </footer>
    </div>
  );
}
