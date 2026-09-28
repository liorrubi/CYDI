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
import { getCategories, getCategoryById, getShapeById, type ShapeDefinition } from "../content/contentRepository";
import { runtimeCatalogCounts } from "./siteShapes";
import { FIRST_ROUND_PREVIEW_SECONDS } from "../content/publicFacts";
// This page's own copy, and the list of the other challenge pages: both static
// modules inside this lazy, web-only chunk - nothing on this page is fetched.
import { challengePageCopyForPath } from "../content/challengePageCopy";
// Numbers precomputed by the real scorer at build time - this page scores nothing.
import { scoredExampleForPath } from "../content/scoredExamplesData";
import { DRAWING_CHALLENGES, type DrawingChallenge } from "../content/drawingChallenges";
import {
  HEAVIEST_CRITERION,
  LOOP_STEPS,
  SCORING_CRITERIA,
  SCORING_INTRO,
  siteFaq,
  spellNumber,
} from "../content/siteContent";

type SeoPracticePageProps = {
  /** The landing path being rendered - the key to this page's own copy. */
  path: string;
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

export default function SeoPracticePage({ path, shape, onPractice, onPlay }: SeoPracticePageProps) {
  const categoryName = getCategoryById(shape.category)?.name ?? "";
  const categories = getCategories();
  // The chip row below renders one chip per entry of `categories`, so the
  // counts stated around it are read from the same catalog, not from the
  // build-time publicFacts numbers. See runtimeCatalogCounts().
  const counts = runtimeCatalogCounts();
  const faq = siteFaq(counts);
  // Every landing path that opens this page has copy (landingPages.test.ts), so
  // the generic heading and lede below are only a fallback for a path added
  // without any.
  const copy = challengePageCopyForPath(path);
  const [lede, ...details] = copy?.paragraphs ?? [];
  const deepDive = copy?.deepDive;
  const scoredExample = deepDive ? scoredExampleForPath(path) : undefined;
  const related = relatedChallenges(path, shape.category, 4);

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
                    {/* The practice hub, not the game's shape map: "Practice" is
                        what /drawing-challenges is, and it is the one page that
                        lists every challenge. */}
                    <a className="site-crumb-link" href="/drawing-challenges">
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
                {copy ? (
                  <HeadingLines heading={copy.heading} />
                ) : (
                  <>
                    Draw {indefiniteArticle(shape.name)} {shape.name.toLowerCase()}
                    <br />
                    from memory
                  </>
                )}
              </h1>

              <p className="site-lede">
                {lede ??
                  `${shape.name} is one of ${counts.shapes} shapes in CYDI. You see the shape, it disappears, and you redraw it from memory in a single attempt. The result is scored on how close your line came to the original outline.`}
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

      {/* ---------------------------------------------------------- detail -- */}
      {/* What is particular about THIS shape - the one section no other challenge
          page shares. Same sentences as the Worker's crawlable block, from the
          same module, so what a visitor reads is what gets indexed. */}
      {copy && (details.length > 0 || copy.image) && (
        <section className="site-band" aria-labelledby="site-detail-heading">
          <div className="site-width">
            <div className={copy.image ? "site-guide site-guide-with-figure" : "site-guide"}>
              <div className="site-guide-copy">
                <span className="site-kicker">About this challenge</span>
                <h2 className="site-h2" id="site-detail-heading">
                  {copy.detailHeading}
                </h2>
                {details.map((paragraph) => (
                  <p className="site-body site-guide-paragraph" key={paragraph.slice(0, 48)}>
                    {paragraph}
                  </p>
                ))}
              </div>
              {copy.image && (
                <figure className="site-guide-figure">
                  <img
                    src={copy.image.src}
                    alt={copy.image.alt}
                    width={copy.image.width}
                    height={copy.image.height}
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>{copy.image.caption}</figcaption>
                </figure>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- deep dive -- */}
      {/* A few pages go further: how the scorer weighs THIS shape, what its
          signature mistake costs, and drills taken from its geometry. Same text
          and numbers as the crawlable block; the numbers were computed by the
          real scorer at build time (scoredExamplesData.ts). */}
      {deepDive && scoredExample && (
        <>
          <section className="site-band site-band-alt" aria-labelledby="site-scorer-heading">
            <div className="site-width">
              <div className="site-guide">
                <span className="site-kicker">Scoring this shape</span>
                <h2 className="site-h2" id="site-scorer-heading">
                  {deepDive.scorerHeading}
                </h2>
                {deepDive.scorerParagraphs.map((paragraph) => (
                  <p className="site-body site-guide-paragraph" key={paragraph.slice(0, 48)}>
                    {paragraph}
                  </p>
                ))}
                <table className="site-datatable">
                  <caption>Each part's share of the line, and of the scorer's comparison points</caption>
                  <thead>
                    <tr>
                      <th scope="col">Part</th>
                      <th scope="col" className="site-datatable-num">
                        Share
                      </th>
                      <th scope="col" className="site-datatable-num">
                        Points
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoredExample.partShares.map((part) => (
                      <tr key={part.name}>
                        <th scope="row">
                          {part.name}
                          <span className="site-sharebar" aria-hidden="true">
                            <span style={{ width: `${part.percent}%` }} />
                          </span>
                        </th>
                        <td className="site-datatable-num">{part.percent}%</td>
                        <td className="site-datatable-num">{part.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="site-band" aria-labelledby="site-example-heading">
            <div className="site-width">
              <div className="site-guide site-guide-with-figure">
                <div className="site-guide-copy">
                  <span className="site-kicker">A scored example</span>
                  <h2 className="site-h2" id="site-example-heading">
                    {deepDive.exampleHeading}
                  </h2>
                  {deepDive.exampleParagraphs.map((paragraph) => (
                    <p className="site-body site-guide-paragraph" key={paragraph.slice(0, 48)}>
                      {paragraph}
                    </p>
                  ))}
                  <table className="site-datatable">
                    <caption>Scored by the game's own scorer, out of 100</caption>
                    <thead>
                      <tr>
                        <th scope="col">Attempt</th>
                        <th scope="col" className="site-datatable-num">
                          Total
                        </th>
                        <th scope="col" className="site-datatable-num">
                          Shape
                        </th>
                        <th scope="col" className="site-datatable-num">
                          Coverage
                        </th>
                        <th scope="col" className="site-datatable-num">
                          Scale
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoredExample.rows.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td className="site-datatable-num site-datatable-total">{row.total}</td>
                          <td className="site-datatable-num">{row.shapeMatch}</td>
                          <td className="site-datatable-num">{row.coverage}</td>
                          <td className="site-datatable-num">{row.scale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <figure className="site-guide-figure">
                  <img
                    src={scoredExample.image}
                    alt={deepDive.exampleImageAlt}
                    width={400}
                    height={400}
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>{deepDive.exampleImageCaption}</figcaption>
                </figure>
              </div>
            </div>
          </section>

          <section className="site-band site-band-alt" aria-labelledby="site-drills-heading">
            <div className="site-width">
              <span className="site-kicker">Practice</span>
              <h2 className="site-h2" id="site-drills-heading">
                {deepDive.drillsHeading}
              </h2>
              <ol className="site-drills">
                {deepDive.drills.map((drill) => (
                  <li className="site-drill" key={drill.title}>
                    <strong className="site-drill-title">{drill.title}</strong>
                    <p className="site-body">{drill.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </>
      )}

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
      {/* Real links to other challenge pages, in the hub's own card - these used
          to be six fixed shapes with no link and no page behind most of them, the
          same six on every challenge. Plain <a href>: a normal navigation, no
          prefetch, nothing loaded until a visitor actually picks one. */}
      {related.length > 0 && (
        <section className="site-band site-band-alt" aria-labelledby="site-more-heading">
          <div className="site-width">
            <div className="site-band-head">
              <div>
                <span className="site-kicker">Keep practising</span>
                <h2 className="site-h2" id="site-more-heading">
                  More drawing challenges
                </h2>
              </div>
              <a className="site-textlink" href="/drawing-challenges">
                All drawing challenges →
              </a>
            </div>
            <div className="site-shapegrid site-shapegrid-challenges">
              {related.map((card) => (
                <a className="site-shapecard site-challengecard" href={card.href} key={card.href}>
                  <span className="site-shapecard-art">
                    <SiteShape shape={card.shape} size={160} strokeWidth={4} variant="site-shape-ink" />
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
          {/*
            * Names, in catalog order - and deliberately NOT controls. These used
            * to be pills, which read as buttons a visitor could press: they never
            * were, and a practice page is the one place that could not honour
            * them anyway. It holds no progression state and must not imply any -
            * which category is unlocked, what the next one costs and what the
            * balance is all live on /draw-shapes-online, which the link below
            * leads to. Still a real list, so the category names stay crawlable.
            */}
          <ul className="site-catnames">
            {categories.map((category) => (
              <li key={category.id}>{category.name}</li>
            ))}
          </ul>
          <p className="site-visually-spaced">
            <a className="site-textlink" href="/draw-shapes-online">
              Explore all {counts.shapes} shapes <span aria-hidden="true">→</span>
            </a>
          </p>
          <p className="site-meta site-visually-spaced">
            {counts.shapes} shapes · {counts.categories} categories · {spellNumber(FIRST_ROUND_PREVIEW_SECONDS)} seconds to
            study your first shape
          </p>
        </div>
      </section>
    </SiteShell>
  );
}

/**
 * The page's own heading, keeping 4a's two-line form: "Draw a Bear" / "From
 * Memory". A heading without that ending ("Draw a Perfect Circle") is one line.
 */
function HeadingLines({ heading }: { heading: string }) {
  const split = heading.match(/^(.*) (From Memory)$/);
  if (!split) return <>{heading}</>;
  return (
    <>
      {split[1]}
      <br />
      {split[2]}
    </>
  );
}

type RelatedChallenge = DrawingChallenge & { shape: ShapeDefinition };

/**
 * Other challenge pages to send a visitor on to: up to three from this shape's
 * own category, then the rest in the hub's order. Deterministic, and drawn from
 * the same list the hub renders, so every card is a page that exists.
 */
function relatedChallenges(currentPath: string, category: string, count: number): RelatedChallenge[] {
  const others = DRAWING_CHALLENGES.filter((challenge) => challenge.href !== currentPath)
    .map((challenge) => ({ ...challenge, shape: getShapeById(challenge.shapeId) }))
    .filter((challenge): challenge is RelatedChallenge => challenge.shape !== undefined);
  const sameCategory = others.filter((challenge) => challenge.shape.category === category).slice(0, 3);
  const rest = others.filter((challenge) => !sameCategory.includes(challenge));
  return [...sameCategory, ...rest].slice(0, count);
}

/** "a compass star" / "an anchor" - so the H1 reads correctly for any catalog name. */
function indefiniteArticle(name: string): string {
  return /^[aeiou]/i.test(name.trim()) ? "an" : "a";
}
