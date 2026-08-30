/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './styles/global.css'
import { applyThemeMode, getThemeMode } from './services/themeStore'
import { landingPageForPath } from './seo/landingPages'

// Stamp the saved theme onto <html> before anything renders, so there's no
// flash of the wrong theme on load.
applyThemeMode(getThemeMode())

const root = createRoot(document.getElementById('root')!)

// The public /privacy page is a standalone document: it must render the privacy
// policy on direct entry/refresh WITHOUT initializing the game or firing any
// game/analytics events. We branch here and dynamically import ONLY the page for
// that path, so the entire <App/> module tree (analytics, save store, ads, etc.)
// is never even loaded when someone visits /privacy directly.
const path = window.location.pathname.replace(/\/+$/, '')

if (path === '/privacy') {
  import('./screens/PrivacyPage.tsx').then(({ default: PrivacyPage }) => {
    root.render(
      <StrictMode>
        <PrivacyPage />
      </StrictMode>,
    )
  })
} else {
  // Remote-content boot: apply the cached catalog (if any) BEFORE the first
  // render so every screen sees one consistent content source, then refresh
  // the cache in the background for the next launch. Both steps fall back to
  // the baked-in content on any failure - see hydrateContent.ts.
  import('./content/hydrateContent.ts').then(async ({ applyCachedCatalog, refreshCatalogInBackground }) => {
    applyCachedCatalog()

    // App.tsx code-splits the public site so none of it reaches the Android
    // WebView (see the comment there). On the web paths that WILL render a site
    // surface, start that chunk alongside the app chunk instead of after it -
    // otherwise the two LCP-sensitive pages, the marketing home and the SEO
    // pages, would each wait a second round trip for it. On native this is
    // always null: Capacitor loads from the APK at "/", and the site chunk is
    // never requested at all.
    const landing = landingPageForPath(path)
    // /play and /play/classic render a game screen wrapped in the site skin,
    // which lives in the same chunk - preloaded here so a direct visit does not
    // flash the placeholder while it arrives.
    const siteChunk = Capacitor.isNativePlatform()
      ? null
      : path === ''
        ? import('./site/SiteHome.tsx')
        : landing?.shape
          ? import('./site/SeoPracticePage.tsx')
          : path.startsWith('/play')
            ? import('./site/SiteGameSkin.tsx')
            : null

    const { default: App } = await import('./App.tsx')
    // Awaited only to keep the first paint from landing on the placeholder; a
    // failure here is not fatal, React.lazy retries and shows the fallback.
    await siteChunk?.catch(() => undefined)
    // Web-only SEO landing paths (see seo/landingPages.ts). Undefined for every
    // other path, and always undefined in the Android WebView, which loads from
    // the APK at "/" - so the app boots exactly as it did before.
    root.render(
      <StrictMode>
        <App landing={landing} />
      </StrictMode>,
    )
    void refreshCatalogInBackground()
  })
}
