/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The drawing-challenges hub, in the site's own 3a language.
 *
 * PRESENTATION ONLY, and deliberately built out of parts that already exist:
 * SiteShell for the shell, `.site-hero` for the header, `.site-shapegrid` /
 * `.site-shapecard` for the cards and SiteShape for the previews - the same
 * card the practice pages already use, so this page cannot drift into a second
 * visual language. It plays nothing, scores nothing and unlocks nothing: every
 * card is a plain <a> to a challenge page, and that page still owns the round.
 *
 * The list comes from src/content/drawingChallenges.ts, which the Worker also
 * builds its crawlable links from, so what a crawler reads and what a visitor
 * sees are the same set.
 *
 * The Worker's crawlable block is handed over by SiteShell - see the H1
 * OWNERSHIP note there.
 */
import SiteShell from "./SiteShell";
import SiteShape from "./SiteShape";
import { DRAWING_CHALLENGES } from "../content/drawingChallenges";
import { getShapeById } from "../content/contentRepository";
import { runtimeCatalogCounts } from "./siteShapes";

type SiteChallengesProps = {
  /** Opens the game shell without pre-selecting anything. */
  onPlay: () => void;
};

export default function SiteChallenges({ onPlay }: SiteChallengesProps) {
  const counts = runtimeCatalogCounts();
  // A card without its preview is still a working link, so a shape id that is
  // not in the active catalog costs the art and nothing else.
  const cards = DRAWING_CHALLENGES.map((challenge) => ({
    ...challenge,
    shape: getShapeById(challenge.shapeId),
  }));

  return (
    <SiteShell
      onPlay={onPlay}
      footerMeta={`${counts.shapes} shapes · ${counts.categories} categories`}
      navExtra={
        <button type="button" className="site-cta site-cta-small" onClick={onPlay}>
          Play now
        </button>
      }
    >
      {/* ------------------------------------------------------------ hero -- */}
      <section className="site-hero">
        <div className="site-hero-grid" aria-hidden="true" />
        <div className="site-width">
          <div className="site-hero-copy site-hero-copy-wide">
            <span className="site-pill">Practice</span>
            <h1 className="site-h1">Drawing Challenges</h1>
            <p className="site-lede">
              One shape, on its own. Study the target for a few seconds, watch it go, redraw it freehand - and CYDI
              scores how close you got, with your line laid over the target.
            </p>
            <div className="site-metarow">
              <span className="site-meta">Nothing to unlock</span>
              <span className="site-metarow-dot" aria-hidden="true" />
              <span className="site-meta">Nothing saved</span>
              <span className="site-metarow-dot" aria-hidden="true" />
              <span className="site-meta">Plays in the browser</span>
            </div>
            {/* What this page is NOT. A visitor who arrives from a Short has no
                way of knowing that these four challenges are a practice corner
                of a much larger game - so say it once, quietly, with the way in
                next to it. Counts come from the live catalog, like every other
                number on the site. */}
            <div className="site-challenges-scope">
              <p className="site-challenges-scope-text">
                Practice mode - individual challenges only. The full CYDI game has {counts.shapes} shapes across{" "}
                {counts.categories} categories, progression, multiplayer and more.
              </p>
              <a
                className="site-cta-ghost site-challenges-scope-cta"
                href="/play/classic"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  onPlay();
                }}
              >
                Play the full game <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- cards -- */}
      <section className="site-band" aria-labelledby="site-challenges-heading">
        <div className="site-width">
          <h2 className="site-h2" id="site-challenges-heading">
            Pick a challenge
          </h2>
          <div className="site-shapegrid site-shapegrid-challenges">
            {cards.map((card) => (
              <a className="site-shapecard site-challengecard" href={card.href} key={card.href}>
                <span className="site-shapecard-art">
                  {card.shape && <SiteShape shape={card.shape} size={160} strokeWidth={4} variant="site-shape-ink" />}
                </span>
                <span className="site-challengecard-text">
                  <strong className="site-shapecard-name">{card.name}</strong>
                  <span className="site-shapecard-category">{card.note}</span>
                </span>
                <span className="site-challengecard-go">
                  Play challenge <span aria-hidden="true">→</span>
                </span>
              </a>
            ))}
          </div>
          <p className="site-body site-challenges-note">
            These are practice rounds: scored for real, and they change nothing in your game - no coins, no best score,
            no unlocks - so any challenge here is playable whether or not you have reached its category in the{" "}
            <a className="site-textlink" href="/draw-shapes-online">
              Shape Challenge
            </a>
            . More are added as they are made;{" "}
            <a className="site-textlink" href="/how-to-play">
              how to play
            </a>{" "}
            explains what the score is measuring.
          </p>
        </div>
      </section>
    </SiteShell>
  );
}
