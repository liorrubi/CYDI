/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'

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
  import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
