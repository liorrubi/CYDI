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
          <strong>Last updated:</strong> 11 August 2026
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
          <li>
            <strong>Play Together (multiplayer):</strong> when you create or join a Play Together room, we hold a
            short-lived game session on our servers so everyone in the room stays in sync. It contains the room
            code, the nickname you type for that game, a randomly generated seat identifier and access token for
            your place in the room, and the live game state — the current round, each player&rsquo;s scores, and
            whether each player has finished drawing. Your drawing IS sent for this mode, because scoring happens
            on our server rather than on your device; it is used only to calculate that round&rsquo;s score and is
            not stored after the round is scored. None of this is linked to your player ID or to any other mode.
          </li>
          <li>
            <strong>How long a Play Together room lasts:</strong> a room is temporary by design. It is deleted
            automatically once nobody has been connected to it for 30 minutes, and nothing from it is kept
            afterwards — the nickname, the scores and the game state all go with it. Play Together nicknames and
            results are not saved to your profile, do not affect your progress, coins or achievements, and are not
            used to build any long-term record. As with display names elsewhere in CYDI, please do not use your
            real name or any contact details as a nickname.
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
        <p className="status-text">
          Play Together sends the same kind of aggregate events — for example that a room was created, that a game
          of a given length and difficulty started, or that a round finished. They carry only counts and settings,
          such as how many players were in the room and which round number it was. They never include the room
          code, any nickname, your seat in the room, or anything you drew.
        </p>
        <p className="status-text">
          So that we can tell “one person played ten rounds” from “ten people played one round each,” an analytics
          event also carries two randomly generated numbers: one that stays the same for this installation of the
          game, and one that identifies the current play session. They are created on your device, are not derived
          from your identity, your account, your IP address, or anything about your device, and are not used to
          track you across other apps or websites. On our server they are used only to count how many distinct
          installations and sessions there were on a given day, and are kept only for the days they were counted in.
          Clearing the app's or browser's local data starts a new random number.
        </p>

        <h3>Advertising (Android app)</h3>
        <p className="status-text">
          The CYDI Android app may offer optional rewarded advertisements through the Google AdMob / Google Mobile
          Ads SDK. After you earn coins, the app may offer you the chance to double them by watching a rewarded
          video ad. Watching is entirely your choice: you can always decline and simply continue with the coins you
          have already earned, which are yours either way.
        </p>
        <p className="status-text">
          A reward that depends on an ad is granted only when an ad is actually served and completed in the way
          Google’s ads SDK itself confirms as a completed reward. If an ad cannot be requested, cannot be shown, or
          does not reach that confirmation, no ad-based reward is granted. Declining, closing, or skipping an ad
          never reduces the coins you have already earned.
        </p>
        <p className="status-text">
          Before requesting an ad, the app checks with Google’s User Messaging Platform (UMP) whether ads may be
          requested and shows a consent form where one is required. If ads may not be requested, no ad is requested
          and no ad-based reward is granted.
        </p>
        <p className="status-text">
          When ads are served, the Google Mobile Ads SDK may automatically collect and share the following for the
          purposes of advertising, measurement, analytics, and fraud prevention, subject to your consent choices
          and Google’s policies:
        </p>
        <ul className="status-text privacy-list">
          <li>Your IP address.</li>
          <li>
            Your approximate (general) location, which is derived from your IP address rather than from device
            location services. CYDI requests no location permission and never collects precise or GPS location.
          </li>
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
            <strong>Analytics</strong> is kept only as anonymous aggregate totals, with no per-person records. The
            random installation and session numbers described above are kept per day, purely to count distinct
            installations and sessions, and are never joined to any other data.
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
