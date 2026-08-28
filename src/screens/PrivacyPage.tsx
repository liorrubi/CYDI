/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect } from "react";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY_HTML,
} from "../content/privacyPolicyHtml";

/**
 * Standalone public Privacy Policy page served at /privacy.
 *
 * Deliberately self-contained: it imports NO game services, analytics, save
 * store, AdMob code, or the main <App/> tree. main.tsx mounts this component
 * (instead of <App/>) when the path is /privacy, so visiting /privacy never
 * initializes the game, never shows game UI, and never fires any game or
 * analytics event.
 *
 * The policy TEXT is not here - it lives in content/privacyPolicyHtml.ts, which
 * worker/contentPages.ts renders as well. On production the Worker answers
 * /privacy with a fully server-rendered document (so crawlers and anything
 * without JavaScript get the real policy), and this component is what serves the
 * same text everywhere the Worker is not in front of the app: `npm run dev`, a
 * plain `vite preview`, and the Android WebView.
 *
 * dangerouslySetInnerHTML is safe here: the markup is static, self-authored, and
 * contains no user input of any kind.
 */
export default function PrivacyPage() {
  useEffect(() => {
    document.title = "CYDI Privacy Policy";
  }, []);

  return (
    <div className="screen privacy-page">
      <div className="privacy-topbar">
        <a className="privacy-back-link" href="/">
          ← Back to Game
        </a>
      </div>

      <div className="card instructions-card privacy-card">
        <h1 className="privacy-title">CYDI Privacy Policy</h1>
        <p className="status-text privacy-dates">
          <strong>Effective date:</strong> {PRIVACY_EFFECTIVE_DATE}
          <br />
          <strong>Last updated:</strong> {PRIVACY_LAST_UPDATED}
        </p>

        <div dangerouslySetInnerHTML={{ __html: PRIVACY_POLICY_HTML }} />

        <p className="status-text privacy-copyright">© 2026 Lior Rubinovich. All rights reserved.</p>

        <div className="privacy-footer">
          <a className="privacy-back-link" href="/">
            ← Back to Game
          </a>
        </div>
      </div>
    </div>
  );
}
