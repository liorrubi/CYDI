/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Art direction 4a: the SEO / practice page presentation.
 *
 * PRESENTATION ONLY. This page does not play, score or unlock anything. The
 * "Practice this shape" button hands the untouched `landing.shape` descriptor -
 * including its `practice: true` flag - to the existing Shape Challenge flow,
 * which is still the only thing that decides what is drawable and still
 * re-checks the player's real unlock state (see seo/landingPages.ts and
 * app/shapeRoundOutcome.ts). Drawing, scoring, progression neutrality, the
 * practice analytics split and shape selection are all unchanged.
 *
 * It also deliberately shares NOTHING with multiplayer: no room, no clock, no
 * player count. The only multiplayer text on the page is the FAQ answer, which
 * is prose from siteContent.ts.
 *
 * The Worker's crawlable block is handed over by SiteShell, which every site
 * surface is built on - see the H1 OWNERSHIP note there.
 */
import SiteShell from "./SiteShell";
import SiteShape from "./SiteShape";
import { getCategories, getCategoryById, type ShapeDefinition } from "../content/contentRepository";
import { resolveSiteShapesOrFirst, runtimeCatalogCounts, PRACTICE_GRID_SHAPE_IDS } from "./siteShapes";
import { FIRST_ROUND_PREVIEW_SECONDS } from "../content/publicFacts";
import {
  HEAVIEST_CRITERION,
  LOOP_STEPS,
  SCORING_CRITERIA,
  SCORING_INTRO,
  siteFaq,
  spellNumber,
} from "../content/siteContent";

type SeoPracticePageProps = {
  /** The shape this page is about, resolved through contentRepository. */
  shape: ShapeDefinition;
  /** Starts the existing practice flow for this shape. */
  onPractice: () => void;
  /** Opens the game shell without pre-selecting anything. */
  onPlay: () => void;
};

const LOOP_BADGE_CLASS: Record<string, string> = {
  Shown: "site-stepcard-badge",
  Hidden: "site-stepcard-badge site-stepcard-badge-muted",
  "1 try": "site-stepcard-badge",
  Scored: "site-stepcard-badge site-stepcard-badge-good",
};

export default function SeoPracticePage({ shape, onPractice, onPlay }: SeoPracticePageProps) {
  const categoryName = getCategoryById(shape.category)?.name ?? "";
  const categories = getCategories();
  // The chip row below renders one chip per entry of `categories`, so the
  // counts stated around it are read from the same catalog, not from the
  // build-time publicFacts numbers. See runtimeCatalogCounts().
  const counts = runtimeCatalogCounts();
  const faq = siteFaq(counts);
  const grid = resolveSiteShapesOrFirst(
    PRACTICE_GRID_SHAPE_IDS.filter((id) => id !== shape.id),
    6,
  );

  return (
    <SiteShell
      onPlay={onPlay}
      footerMeta={`${counts.shapes} shapes · ${counts.categories} categories`}
      navExtra={
        <button type="button" className="site-cta site-cta-small" onClick={onPlay}>
          Play
        </button>
      }
    >
      {/* ------------------------------------------------------------ hero -- */}
      <section className="site-hero">
        <div className="site-hero-grid" aria-hidden="true" />
        <div className="site-width">
          <div className="site-hero-inner">
            <div className="site-hero-copy">
              <nav aria-label="Breadcrumb">
                <ol className="site-crumbs">
                  <li>
                    <a className="site-crumb-link" href="/draw-shapes-online">
                      Practice
                    </a>
                  </li>
                  {categoryName && (
                    <>
                      <li className="site-crumbs-sep" aria-hidden="true">
                        /
                      </li>
                      <li>{categoryName}</li>
                    </>
                  )}
                  <li className="site-crumbs-sep" aria-hidden="true">
                    /
                  </li>
                  <li aria-current="page">{shape.name}</li>
                </ol>
              </nav>

              <h1 className="site-h1">
                Draw {indefiniteArticle(shape.name)} {shape.name.toLowerCase()}
                <br />
                from memory
              </h1>

              <p className="site-lede">
                {shape.name} is one of {counts.shapes} shapes in CYDI. You see the shape, it disappears, and you redraw
                it from memory in a single attempt. The result is scored on how close your line came to the original
                outline.
              </p>

              <div className="site-hero-actions">
                <button type="button" className="site-cta site-cta-large" onClick={onPractice}>
                  Practice this shape
                </button>
                <button type="button" className="site-cta-ghost" onClick={onPlay}>
                  Play a full round
                </button>
              </div>

              <div className="site-metarow">
                <span className="site-meta">One attempt</span>
                <span className="site-metarow-dot" aria-hidden="true" />
                <span className="site-meta">No guide while you draw</span>
                <span className="site-metarow-dot" aria-hidden="true" />
                <span className="site-meta">Plays in the browser</span>
              </div>
            </div>

            <div className="site-paper">
              <div className="site-paper-head">
                <span className="site-paper-label">Target shape</span>
                {categoryName && <span className="site-paper-tag">{categoryName}</span>}
              </div>
              <div className="site-canvas site-canvas-square">
                <SiteShape shape={shape} size={220} strokeWidth={5} animated replayKey={shape.id} />
              </div>
              <div className="site-paper-foot">
                <strong className="site-paper-name">{shape.name}</strong>
                <span className="site-paper-category">Real catalog geometry</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ loop -- */}
      <section className="site-band site-band-alt" aria-labelledby="site-loop-heading">
        <div className="site-width">
          <span className="site-kicker">The loop</span>
          <h2 className="site-h2 site-visually-spaced" id="site-loop-heading">
            See → Remember → Draw → Compare &amp; score
          </h2>
          <div className="site-stepgrid">
            {LOOP_STEPS.map((step, index) => (
              <div
                className={index === LOOP_STEPS.length - 1 ? "site-stepcard site-stepcard-final" : "site-stepcard"}
                key={step.title}
              >
                <div className="site-stepcard-art">
                  {/* The same real shape at every stage of the loop: shown,
                      hidden, drawn, compared. Step 2 renders nothing on purpose. */}
                  {index !== 1 && (
                    <SiteShape
                      shape={shape}
                      size={140}
                      strokeWidth={4}
                      variant={index >= 2 ? undefined : "site-shape-ink"}
                    />
                  )}
                  <span className={LOOP_BADGE_CLASS[step.badge] ?? "site-stepcard-badge"}>{step.badge}</span>
                </div>
                <strong className="site-stepcard-title">
                  {index + 1} · {step.title}
                </strong>
                <p className="site-body">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- scoring -- */}
      <section className="site-band" aria-labelledby="site-scoring-heading">
        <div className="site-width">
          <span className="site-kicker">Scoring</span>
          <h2 className="site-h2" id="site-scoring-heading">
            What the score measures
          </h2>
          <p className="site-lede site-visually-spaced">{SCORING_INTRO}</p>

          <div className="site-criteria">
            {SCORING_CRITERIA.map((criterion) => (
              <div
                className={
                  criterion.name === HEAVIEST_CRITERION.name
                    ? "site-criterion site-criterion-heaviest"
                    : "site-criterion"
                }
                key={criterion.name}
              >
                <span className="site-criterion-kicker">
                  {criterion.name === HEAVIEST_CRITERION.name ? "Largest part" : criterion.kicker}
                </span>
                <strong className="site-criterion-name">{criterion.name}</strong>
                <p className="site-body">{criterion.body}</p>
              </div>
            ))}
          </div>

          {/* The same four criteria as rows, which is 4a's narrow-screen form. */}
          <dl className="site-facts site-criteria-rows">
            {SCORING_CRITERIA.map((criterion) => (
              <div className="site-fact" key={criterion.name}>
                <dt className="site-fact-label">
                  <strong>{criterion.name}</strong>
                </dt>
                <dd className="site-fact-value">{criterion.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------------------------------------------------- keep practising */}
      {grid.length > 0 && (
        <section className="site-band site-band-alt" aria-labelledby="site-more-heading">
          <div className="site-width">
            <div className="site-band-head">
              <div>
                <span className="site-kicker">Keep practising</span>
                <h2 className="site-h2" id="site-more-heading">
                  More shapes to draw from memory
                </h2>
              </div>
              <a className="site-textlink" href="/draw-shapes-online">
                All {counts.categories} categories →
              </a>
            </div>
            <div className="site-shapegrid">
              {grid.map((entry) => (
                <div className="site-shapecard" key={entry.shape.id}>
                  <div className="site-shapecard-art">
                    <SiteShape shape={entry.shape} size={120} strokeWidth={4} variant="site-shape-ink" />
                  </div>
                  <div>
                    <strong className="site-shapecard-name">{entry.shape.name}</strong>
                    <br />
                    <span className="site-shapecard-category">{entry.categoryName}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- FAQ -- */}
      <section className="site-band" aria-labelledby="site-faq-heading">
        <div className="site-width">
          <div className="site-faq">
            <div>
              <span className="site-kicker">FAQ</span>
              <h2 className="site-h2" id="site-faq-heading">
                Questions people ask
              </h2>
              <p className="site-lede">Short answers, and the same wording the game itself uses.</p>
            </div>
            <dl className="site-faq-list">
              {faq.map((entry) => (
                <div className="site-faq-item" key={entry.question}>
                  <dt className="site-faq-q">{entry.question}</dt>
                  <dd className="site-faq-a">{entry.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ browse categories -- */}
      <section className="site-band site-band-alt" aria-labelledby="site-categories-heading">
        <div className="site-width">
          <span className="site-kicker" id="site-categories-heading">
            Browse categories
          </span>
          {/* One chip per catalog category, in catalog order - not a fixed list. */}
          <ul className="site-chips">
            {categories.map((category) => (
              <li key={category.id}>
                <span className="site-chip">{category.name}</span>
              </li>
            ))}
          </ul>
          <p className="site-meta site-visually-spaced">
            {counts.shapes} shapes · {counts.categories} categories · {spellNumber(FIRST_ROUND_PREVIEW_SECONDS)} seconds to
            study your first shape
          </p>
        </div>
      </section>
    </SiteShell>
  );
}

/** "a compass star" / "an anchor" - so the H1 reads correctly for any catalog name. */
function indefiniteArticle(name: string): string {
  return /^[aeiou]/i.test(name.trim()) ? "an" : "a";
}
