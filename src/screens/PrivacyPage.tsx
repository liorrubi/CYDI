/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import { useEffect } from "react";

/**
 * Standalone public Privacy Policy page served at /privacy.
 *
 * Deliberately self-contained: it imports NO game services, analytics, save
 * store, AdMob code, or the main <App/> tree. main.tsx mounts this component
 * (instead of <App/>) when the path is /privacy, so visiting /privacy never
 * initializes the game, never shows game UI, and never fires any game or
 * analytics event. The only content that matches actual app behavior is stated
 * here - see the code audit this file is based on.
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
          <strong>Effective date:</strong> 14 July 2026
          <br />
          <strong>Last updated:</strong> 23 July 2026
        </p>

        <p className="status-text">
          CYDI (“Can You Draw It?”) is a casual drawing game available on the web at{" "}
          <a href="https://playcydi.com">playcydi.com</a> and as an Android app. This policy explains what
          information the game collects, how it is used, and the choices you have. CYDI does not require an
          account, a login, or your real name to play.
        </p>

        <h2>1. Information We Collect</h2>

        <h3>Stored on your device</h3>
        <p className="status-text">
          Most of your data never leaves your device. It is saved in your browser’s (or the app’s) local storage
          on the device you play on:
        </p>
        <ul className="status-text privacy-list">
          <li>Your game progress, scores, achievements, unlocked shapes, categories, ink colors, and pen skins.</li>
          <li>Your settings: difficulty level, sound preference, and selected pen.</li>
          <li>Any challenges you create in the game.</li>
          <li>
            An anonymous player ID that is randomly generated on your device the first time you play and is not
            linked to your real identity.
          </li>
          <li>
            An optional display name that you may choose. It is entirely optional; if you do not set one, the
            default is “Anonymous Player.” Users should not enter their real name, contact details, or other
            personal information as their display name.
          </li>
        </ul>
        <p className="status-text">
          This on-device data is not automatically backed up to us. Clearing your browser/app data, switching
          devices, or reinstalling can erase it. You can move it yourself using the in-game Backup &amp; Transfer
          code feature.
        </p>

        <h3>Information sent to our servers</h3>
        <p className="status-text">
          Some optional features send a limited amount of data to our servers (hosted on Cloudflare):
        </p>
        <ul className="status-text privacy-list">
          <li>
            <strong>Daily Challenge leaderboard:</strong> when you play the Daily Challenge, we send your anonymous
            player ID, your chosen display name, the challenge (episode) ID, and your numeric score (an integer
            from 0–100). Your drawing itself is never sent — only the score. If you set a display name, it appears
            next to your score on the public Daily Challenge leaderboard, visible to other players.
          </li>
          <li>
            <strong>Shareable links:</strong> when you create a short share link for a challenge or result, the
            shared content (the challenge or result data, including a simplified version of the drawing) is stored
            so the link recipient can open it. These share entries do not include your player ID or display name,
            and they automatically expire after 180 days. Links you share as a full web address instead (a link
            containing a long “#…” fragment) are self-contained — that data lives only inside the link and is not
            sent to or stored by us.
          </li>
        </ul>

        <h3>Game content updates</h3>
        <p className="status-text">
          CYDI may download updated game content, such as shapes, categories, level ordering, and related
          metadata, from our servers. This content may be cached locally on your device for faster loading and
          offline use. The downloaded game-content catalog does not contain personal information and is not linked
          to your real identity.
        </p>

        <h3>Analytics</h3>
        <p className="status-text">
          We use anonymous, aggregate analytics to understand how the game is used and to improve it. Analytics
          events record only non-identifying facts such as “a shape was completed” or “a purchase was made with
          in-game coins,” together with a small set of non-personal attributes. These events never include your
          name, email, player ID, IP address, or other information that identifies you — identifying fields are
          blocked before an event is sent and again on our server, which keeps only running totals, never a record
          of individual events. On the website, we also use Cloudflare Web Analytics for aggregate site metrics
          (such as visits, referrers, and performance). This is disabled during development.
        </p>

        <h3>Advertising (Android app)</h3>
        <p className="status-text">
          The CYDI Android app may offer optional rewarded advertisements through the Google AdMob / Google Mobile
          Ads SDK (a “watch an ad to double your reward” feature). Rewarded ads are always optional — you can earn
          the same reward instead by solving a short math question.
        </p>
        <p className="status-text">
          Before requesting an ad, the app checks with Google’s User Messaging Platform (UMP) whether ads may be
          requested and shows a consent form where one is required. If ads may not be requested, no ad is requested
          and the non-ad option is used.
        </p>
        <p className="status-text">
          When ads are served, the Google Mobile Ads SDK may automatically collect and share the following for the
          purposes of advertising, measurement, analytics, and fraud prevention, subject to your consent choices
          and Google’s policies:
        </p>
        <ul className="status-text privacy-list">
          <li>Your IP address.</li>
          <li>Your product interactions, including app launches, taps, and video views.</li>
          <li>Diagnostic and performance information.</li>
          <li>Device and account identifiers, including your Advertising ID and App Set ID.</li>
        </ul>
        <p className="status-text">
          On Android, the app declares the advertising ID (AD_ID) and Android Privacy Sandbox permissions used by
          the ads SDK. For more information, see “How Google uses information from apps that use its services” (
          <a href="https://policies.google.com/technologies/partner-sites">
            https://policies.google.com/technologies/partner-sites
          </a>
          ).
        </p>
        <p className="status-text">
          The <strong>web version</strong> of CYDI does not load any advertising SDK and makes no ad requests.
        </p>

        <h3>Connection data</h3>
        <p className="status-text">
          As with any website or online service, our hosting provider (Cloudflare) processes basic connection
          data such as your IP address at the network level in order to deliver requests. CYDI itself does not
          read, log, or store your IP address.
        </p>

        <h2>2. How We Use Information</h2>
        <ul className="status-text privacy-list">
          <li>To run the game and save your progress and settings on your device.</li>
          <li>To operate the Daily Challenge leaderboard and the challenge-sharing features you choose to use.</li>
          <li>To understand aggregate usage and improve the game.</li>
          <li>When enabled, to show optional rewarded ads through Google AdMob with your consent.</li>
        </ul>

        <h2>3. Advertising &amp; Consent Choices</h2>
        <p className="status-text">
          Where required, a consent form is shown before any ad request, managed through Google’s User Messaging
          Platform. Where applicable, a “Privacy Options” entry is available in the app’s Settings so you can
          review or change your ad-consent choices at any time. For more information about how Google uses data in
          its advertising products, see Google’s resources linked below.
        </p>

        <h2>4. Service Providers</h2>
        <ul className="status-text privacy-list">
          <li>
            <strong>Cloudflare</strong> — hosts the game and its server features (leaderboard, share links) and
            provides aggregate web analytics. Cloudflare privacy information:{" "}
            <a href="https://www.cloudflare.com/privacypolicy/">https://www.cloudflare.com/privacypolicy/</a>.
          </li>
          <li>
            <strong>Google</strong> — provides the AdMob / Google Mobile Ads SDK and consent tooling used in the
            Android app (when advertising is enabled). Google Privacy Policy:{" "}
            <a href="https://policies.google.com/privacy">https://policies.google.com/privacy</a>. How Google uses
            data for advertising:{" "}
            <a href="https://policies.google.com/technologies/ads">https://policies.google.com/technologies/ads</a>.
          </li>
        </ul>

        <h2>5. Data Retention</h2>
        <ul className="status-text privacy-list">
          <li>
            <strong>On-device data</strong> stays on your device until you clear it (for example by clearing app
            or browser data, or uninstalling). We do not keep a copy.
          </li>
          <li>
            <strong>Share links</strong> stored on our server automatically expire after 180 days.
          </li>
          <li>
            <strong>Daily Challenge leaderboard</strong> entries (anonymous player ID, display name, score) are
            not deleted automatically. They are retained until deleted by us or in response to a deletion request.
            Only the top scores for each daily episode are kept.
          </li>
          <li>
            <strong>Analytics</strong> is kept only as anonymous aggregate totals, with no per-person records.
          </li>
        </ul>

        <h2>6. Your Rights &amp; Choices</h2>
        <ul className="status-text privacy-list">
          <li>
            You can clear your on-device data at any time through your browser or Android app settings, which
            removes your local progress and your anonymous player ID.
          </li>
          <li>You can play without setting a display name; leave it as “Anonymous Player” to stay unnamed.</li>
          <li>Where advertising and consent apply, you can review or change your choices via Privacy Options in Settings.</li>
          <li>
            Leaderboard data is associated with a randomly generated device ID and any optional display name you
            choose. You can find and copy your Privacy Request ID in Settings and include it when requesting access
            to or deletion of leaderboard data.
          </li>
          <li>
            Short-link share entries are not associated with your player ID or display name. To request deletion of
            a share entry before its automatic 180-day expiry, provide us with the complete share URL.
          </li>
          <li>
            Depending on where you live, you may have additional rights (such as to access or delete personal
            data). Contact us and we will respond as required by applicable law.
          </li>
        </ul>

        <h2>7. Children</h2>
        <p className="status-text">
          CYDI is intended for a general audience and is not directed to children under 13 (or the minimum age of
          digital consent in your region). We do not knowingly collect personal information from children. The
          game requires no account or real name, and users are instructed not to enter personal information as
          their display name. The default profile name is “Anonymous Player.” If you believe a child has provided
          us with personal information, please contact us and we will delete it.
        </p>

        <h2>8. Virtual Coins &amp; Development Status</h2>
        <ul className="status-text privacy-list">
          <li>
            CYDI Coins are virtual in-game points only. They have no real-world monetary value and cannot be
            exchanged, redeemed, or converted into real money or any other currency.
          </li>
          <li>
            CYDI is in active development. Features, balancing, and content may change, and we make no commitment
            to restore progress or coins lost due to clearing local data, switching devices, technical issues, or
            updates.
          </li>
        </ul>

        <h2>9. Changes to This Policy</h2>
        <p className="status-text">
          We may update this policy as the game evolves — for example, before enabling advertising in production.
          When we make material changes, we will update the “Last updated” date above.
        </p>

        <h2>10. Contact</h2>
        <p className="status-text">
          Privacy questions or requests: <a href="mailto:privacy@playcydi.com">privacy@playcydi.com</a>
          <br />
          General support: <a href="mailto:support@playcydi.com">support@playcydi.com</a>
        </p>

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
