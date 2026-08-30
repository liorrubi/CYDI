/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The approved 5b Game Hub for "/play", on the web.
 *
 * WHAT THIS IS. "/play" is the secondary hub - Daily Challenge, Create, My
 * Challenges, Shop and progression - reached as "More challenges" from the site
 * and "Game menu" from inside the game. It is NOT a step on the way into
 * Classic: every primary entry on SiteHome goes straight to /play/classic, and
 * the Shape Challenge card here is a direct link, not a gate.
 *
 * PRESENTATION ONLY, AND FULLY CONTROLLED. It owns no navigation and no
 * persistence: every action is a prop handed down by HomeScreen, which still
 * owns the routing, the sounds and the analytics. What it does own is reading
 * the canonical state the layout contract asks it to display.
 *
 * Android never renders this: HomeScreen only reaches for it on the web, so the
 * existing Android home screen is untouched.
 *
 * THE LAYOUT CONTRACT, region by region, and where each binding comes from:
 *
 *   Header        Not rebuilt here. AppHeader already satisfies it - the logo
 *                 goes to SiteHome via ExplicitHomeContext, HomeModeTabs is the
 *                 Classic / 2 Players / Multiplayer nav, and CoinIndicator is
 *                 the live-balance Shop control.
 *   Play row      Shape Challenge is the primary card; Daily Challenge is its
 *                 companion, not a fourth mode. Daily state is played / not
 *                 played, from the episode's own `yourBest`.
 *   Challenges    Create -> Share -> Replay. The list renders from
 *                 getChallenges(); an empty list renders the empty state with
 *                 its own Create action.
 *   Shop          One destination, with the verified scope line: pens and ink
 *                 are cosmetics that apply in all three modes, chests and Mega
 *                 cards are single-player progression.
 *   Progress      Achievements is the only action. Personal best and the
 *                 Champion title are readouts with no invented links.
 *
 * NOTHING HERE IS FIXED COPY WHERE THE CODE HAS A SOURCE. Coins, daily state,
 * the challenge list, best score and champion status all read their canonical
 * store. Two places where the mockup's literals were NOT copied, on the
 * canonical-source rule this project has followed throughout:
 *
 *   "1,240" coins            -> the real balance from coinsStore.
 *   "Champion title / Held by Noa"
 *                            -> there is no global champion holder anywhere in
 *                               the codebase. isChallengeChampion() is a local
 *                               boolean about THIS player, so the readout is
 *                               this player's own title status. Inventing a
 *                               name would be fabricating data.
 */
import { useEffect, useState } from "react";
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import SiteShape from "./SiteShape";
import { resolveSiteShapesOrFirst } from "./siteShapes";
import { CHAMPION_TITLE } from "../app/constants";
import { getCoins, onCoinsChanged } from "../services/coinsStore";
import { getChallenges } from "../services/challengeStorage";
import { isChallengeShared } from "../services/sharedChallengesStore";
import { SHARE_FEEDBACK_MS } from "../services/challengeShare";
import { getProgress } from "../services/shapeChallengeProgress";
import { isChallengeChampion } from "../services/megaChallengeStore";
import { fetchCurrentDailyEpisode } from "../services/dailyChallengeApi";
import { getPlayerId } from "../services/playerProfileStore";
import type { Challenge } from "../types/Challenge";
import type { ShapeDefinition } from "../engine/shapeLibrary";
import "../styles/site.css";
import "../styles/gameHub.css";

/** Catalog ids for the two art slots the contract gives real shapes. */
const CLASSIC_ART_ID = "univ-compass";
const DAILY_ART_ID = "fant-crown";
const CREATE_ART_ID = "nat-leaf";

/** How many saved challenges the hub previews before deferring to My Challenges. */
const CHALLENGE_PREVIEW_LIMIT = 3;

type DailyState = "unknown" | "played" | "not-played";

type GameHubProps = {
  onPlayClassic: () => void;
  onDailyChallenge: () => void;
  onCreate: () => void;
  /** The full My Challenges screen, which also owns deleting. */
  onMyChallenges: () => void;
  /**
   * Runs the real, canonical share for one challenge and resolves with what to
   * tell the player (services/challengeShare.ts). The hub does not re-implement
   * any of it - link creation, the share sheet, the clipboard fallback and the
   * sharing-achievement credit are all the same single implementation the My
   * Challenges screen uses.
   */
  onShareChallenge: (challenge: Challenge) => Promise<{ message: string | null; sticky: boolean; recorded: boolean }>;
  /** Replays one saved challenge directly. */
  onPlayChallenge: (challengeId: string) => void;
  onShop: () => void;
  onAchievements: () => void;
};

/**
 * Renders a saved challenge's own drawing.
 *
 * A Challenge stores a DrawingPath, not a catalog shape, so it is wrapped in the
 * ShapeDefinition shape ShapePreviewIcon already understands: `generate` just
 * hands back the stored path, and the icon's own viewBox is set to the canvas
 * that path was drawn on. That reuses the existing renderer - including the way
 * it splits at `breaks` so no connector line is drawn between separate strokes -
 * instead of re-implementing drawing here.
 */
function challengeAsShape(challenge: Challenge): ShapeDefinition {
  return {
    id: challenge.id,
    name: challenge.name,
    category: "geometric",
    generate: () => challenge.target,
  };
}

export default function GameHub({
  onPlayClassic,
  onDailyChallenge,
  onCreate,
  onMyChallenges,
  onPlayChallenge,
  onShareChallenge,
  onShop,
  onAchievements,
}: GameHubProps) {
  const [coins, setCoins] = useState(() => getCoins());
  const [challenges] = useState<Challenge[]>(() => getChallenges());
  const [daily, setDaily] = useState<DailyState>("unknown");
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  /* Bumped after a share is recorded, so the row's chip re-reads its shared
   * state and flips from Share to Replay without a reload. */
  const [sharedVersion, setSharedVersion] = useState(0);
  const [sharingId, setSharingId] = useState<string | null>(null);

  useEffect(() => onCoinsChanged(() => setCoins(getCoins())), []);

  /*
   * Whether today's Daily has been played is the server's answer, not a local
   * flag - the episode carries `yourBest`. It is fetched after paint and is
   * allowed to fail: the hub renders the Daily card either way and simply says
   * nothing about state until it knows, so an offline or slow visitor still
   * gets a working hub rather than a spinner or a wrong badge.
   */
  useEffect(() => {
    let cancelled = false;
    fetchCurrentDailyEpisode(getPlayerId())
      .then((episode) => {
        if (cancelled || !episode) return;
        setDaily(episode.yourBest === null ? "not-played" : "played");
      })
      .catch(() => {
        /* Leave it "unknown"; the card stays usable. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const classicArt = resolveSiteShapesOrFirst([CLASSIC_ART_ID], 1)[0]?.shape;
  const dailyArt = resolveSiteShapesOrFirst([DAILY_ART_ID], 1)[0]?.shape;
  const createArt = resolveSiteShapesOrFirst([CREATE_ART_ID], 1)[0]?.shape;

  const bestScores = Object.values(getProgress().bestScores);
  const personalBest = bestScores.length > 0 ? Math.max(...bestScores) : null;
  const isChampion = isChallengeChampion();

  const preview = challenges.slice(0, CHALLENGE_PREVIEW_LIMIT);

  async function handleShare(challenge: Challenge) {
    if (sharingId) return;
    setSharingId(challenge.id);
    try {
      const result = await onShareChallenge(challenge);
      if (result.recorded) setSharedVersion((n) => n + 1);
      setShareFeedback(result.message);
      // The failure message carries the link itself, so it stays until the
      // player has had a chance to copy it; everything else clears on a timer.
      if (result.message && !result.sticky) {
        window.setTimeout(() => setShareFeedback(null), SHARE_FEEDBACK_MS);
      }
    } finally {
      setSharingId(null);
    }
  }

  return (
    <div className="site-hub">
      <header className="site-hub-intro">
        <h1 className="site-hub-title">More ways to play</h1>
        <p className="site-hub-sub">Everything in CYDI, in one place</p>
      </header>

      {/* ---------------------------------------------------------- play row */}
      <section className="site-hub-section" aria-labelledby="site-hub-play">
        <div className="site-hub-rule">
          <h2 className="site-hub-kicker" id="site-hub-play">
            Play now
          </h2>
        </div>

        <div className="site-hub-playrow">
          <div className="site-hub-card site-hub-classic">
            {classicArt && (
              <span className="site-hub-art site-hub-art-lg">
                <SiteShape shape={classicArt} size={120} strokeWidth={5} variant="site-shape-ink" />
              </span>
            )}
            <div className="site-hub-cardbody">
              <span className="site-hub-eyebrow site-hub-eyebrow-classic">Solo · the main game</span>
              <h3 className="site-hub-cardtitle">Shape Challenge</h3>
              <p className="site-hub-cardtext">
                A shape appears, disappears, and you draw it from memory. Earns coins as you go.
              </p>
              <button type="button" className="site-hub-cta site-hub-cta-primary" onClick={onPlayClassic}>
                Play Classic
              </button>
            </div>
          </div>

          <div className="site-hub-card site-hub-daily">
            <div className="site-hub-dailyhead">
              {dailyArt && (
                <span className="site-hub-art site-hub-art-sm">
                  <SiteShape shape={dailyArt} size={120} strokeWidth={5} variant="site-shape-ink" />
                </span>
              )}
              <span className="site-hub-tag">Today only</span>
            </div>
            <h3 className="site-hub-cardtitle">Daily Challenge</h3>
            <p className="site-hub-cardtext">One shape a day, the same for everyone, with its own leaderboard.</p>
            {daily !== "unknown" && (
              <p className={daily === "played" ? "site-hub-dailystate-done" : "site-hub-dailystate"}>
                {daily === "played" ? "Played today" : "Not played yet"}
              </p>
            )}
            <button type="button" className="site-hub-cta site-hub-cta-daily" onClick={onDailyChallenge}>
              {daily === "played" ? "See today's board" : "Play today's"}
            </button>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- your challenges */}
      <section className="site-hub-section site-hub-challenges" aria-labelledby="site-hub-yours">
        <div className="site-hub-rule">
          <h2 className="site-hub-kicker site-hub-kicker-create" id="site-hub-yours">
            Your challenges
          </h2>
          <span className="site-hub-flow" aria-hidden="true">
            Create <i>→</i> Share <i>→</i> Replay
          </span>
        </div>
        <p className="site-hub-sectiontext">
          Set your own target shape, send it to anyone, and come back to what you and others have played.
        </p>

        <div className="site-hub-challengerow">
          <div className="site-hub-card site-hub-create">
            <h3 className="site-hub-cardtitle">Create Challenge</h3>
            <div className="site-hub-createbody">
              {createArt && (
                <span className="site-hub-art site-hub-art-md site-hub-art-dotted">
                  <SiteShape shape={createArt} size={120} strokeWidth={5} variant="site-shape-ink" animated />
                </span>
              )}
              <p className="site-hub-cardtext">
                Pick a shape, set it as the target, and CYDI turns it into a challenge with a shareable link.
              </p>
            </div>
            <button type="button" className="site-hub-cta site-hub-cta-create" onClick={onCreate}>
              Create a challenge
            </button>
          </div>

          <div className="site-hub-card site-hub-mine">
            <div className="site-hub-minehead">
              <h3 className="site-hub-cardtitle site-hub-cardtitle-sm">My Challenges</h3>
              {challenges.length > 0 && (
                <button type="button" className="site-hub-textlink" onClick={onMyChallenges}>
                  All {challenges.length}
                </button>
              )}
            </div>

            {preview.length > 0 ? (
              <>
                <ul className="site-hub-minelist">
                  {preview.map((challenge) => {
                    void sharedVersion; // re-read after a share is recorded
                    const shared = isChallengeShared(challenge.id);
                    return (
                      <li className="site-hub-mineitem" key={challenge.id}>
                        <span className="site-hub-minethumb">
                          <ShapePreviewIcon
                            shape={challengeAsShape(challenge)}
                            size={challenge.target.canvasWidth}
                            strokeWidth={challenge.target.canvasWidth / 26}
                            className="site-shape site-shape-ink"
                          />
                        </span>
                        <span className="site-hub-minetext">
                          <strong className="site-hub-minename">{challenge.name}</strong>
                          <span className="site-hub-minemeta">{shared ? "Shared" : "Not shared"}</span>
                        </span>
                        {/* Both act here. Share runs the canonical flow from
                            services/challengeShare.ts - the same one My
                            Challenges runs - so the label is truthful: a link
                            really is offered, and a real share is credited. */}
                        {shared ? (
                          <button
                            type="button"
                            className="site-hub-chip site-hub-chip-replay"
                            onClick={() => onPlayChallenge(challenge.id)}
                          >
                            Replay
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="site-hub-chip site-hub-chip-share"
                            disabled={sharingId === challenge.id}
                            onClick={() => handleShare(challenge)}
                          >
                            {sharingId === challenge.id ? "Sharing…" : "Share"}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {shareFeedback ? (
                  <p className="site-hub-sharefeedback" role="status">
                    {shareFeedback}
                  </p>
                ) : (
                  <p className="site-hub-minenote">Your saved challenges, ready to share and replay.</p>
                )}
              </>
            ) : (
              <div className="site-hub-empty">
                <span className="site-hub-emptymark" aria-hidden="true">
                  +
                </span>
                <strong className="site-hub-emptytitle">No challenges yet</strong>
                <span className="site-hub-emptytext">Make one and it will be saved here to share and replay.</span>
                <button type="button" className="site-hub-cta site-hub-cta-small" onClick={onCreate}>
                  Create a challenge
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- shop row */}
      <section className="site-hub-shop" aria-labelledby="site-hub-shop-heading">
        <div className="site-hub-shoptext">
          <h2 className="site-hub-cardtitle site-hub-cardtitle-sm" id="site-hub-shop-heading">
            Shop — pens, ink colors, chests &amp; Mega cards
          </h2>
          <p className="site-hub-cardtext">
            Pens and ink colors apply in Classic, 2 Players and Multiplayer. Chest keys and Mega cards are single-player
            progression.
          </p>
        </div>
        <button type="button" className="site-hub-shopcta" onClick={onShop}>
          <span className="site-hub-coindot" aria-hidden="true" />
          {coins.toLocaleString()} · Open Shop
        </button>
      </section>

      {/* --------------------------------------------------------- progress */}
      <section className="site-hub-section" aria-labelledby="site-hub-progress">
        <div className="site-hub-rule">
          <h2 className="site-hub-kicker" id="site-hub-progress">
            Progress
          </h2>
        </div>
        <div className="site-hub-progressrow">
          {/* The only action in this region, per the contract. */}
          <button type="button" className="site-hub-stat site-hub-stat-action" onClick={onAchievements}>
            <span className="site-hub-statmark" aria-hidden="true">
              ★
            </span>
            <span className="site-hub-stattext">
              <strong className="site-hub-statvalue-sm">Achievements</strong>
              <span className="site-hub-statlabel-sub">Unlocked as you play</span>
            </span>
            <span className="site-hub-chip site-hub-chip-open">Open</span>
          </button>

          {/* Readouts, not links. */}
          <p className="site-hub-stat">
            <span className="site-hub-stattext">
              <span className="site-hub-statlabel">Personal best</span>
              <strong className="site-hub-statvalue">{personalBest === null ? "—" : `${personalBest}%`}</strong>
            </span>
            <span className="site-hub-statnote">
              {personalBest === null ? "Play a round to set one" : "Your top score so far"}
            </span>
          </p>

          <p className="site-hub-stat">
            <span className="site-hub-statmark site-hub-statmark-crown" aria-hidden="true">
              ♛
            </span>
            <span className="site-hub-stattext">
              <span className="site-hub-statlabel">Champion title</span>
              <strong className="site-hub-statvalue-sm">{isChampion ? CHAMPION_TITLE : "Not earned yet"}</strong>
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}
