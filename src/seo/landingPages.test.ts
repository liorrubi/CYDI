import test from "node:test";
import assert from "node:assert/strict";

const { LANDING_PATHS, landingPageForPath } = await import("./landingPages.ts");
const { LANDING_CTA_HASH, landingCtaMode } = await import("./landingCta.ts");
// Worker-side SEO definitions - pure data/string builders, so they import fine
// under plain Node. This is the whole point of the file split: if a path is added
// or renamed on one side only, this test fails instead of shipping a landing page
// with metadata but no destination (or the reverse).
const {
  LANDING_PATHS: WORKER_LANDING_PATHS,
  seoPageForPath,
  SEO_PAGES,
  PLAY_STORE_URL: SEO_PLAY_STORE_URL,
  canonicalUrl,
  renderSeoSection,
  robotsTxt,
  sitemapXml,
} = await import("../../worker/seoPages.ts");
const { CONTENT_PATHS } = await import("../../worker/contentPages.ts");

test("app and Worker agree on the landing paths", () => {
  assert.deepEqual([...LANDING_PATHS].sort(), [...WORKER_LANDING_PATHS].sort());
});

test("every landing path has Worker metadata, and vice versa", () => {
  for (const path of LANDING_PATHS) {
    const page = seoPageForPath(path);
    assert.ok(page, `no Worker SEO page for ${path}`);
    assert.ok(page.title.length > 0 && page.description.length > 0 && page.h1.length > 0);
  }
  for (const path of WORKER_LANDING_PATHS) {
    assert.ok(landingPageForPath(path), `no app landing entry for ${path}`);
  }
});

test("titles, descriptions and H1s are unique across pages", () => {
  for (const field of ["title", "description", "h1"] as const) {
    const values = SEO_PAGES.map((page) => page[field]);
    assert.equal(new Set(values).size, values.length, `duplicate ${field}`);
  }
});

test("paths outside the list are not landing pages", () => {
  assert.equal(landingPageForPath("/"), undefined);
  assert.equal(landingPageForPath("/privacy"), undefined);
  assert.equal(landingPageForPath("/c/ABCD1234"), undefined);
});

test("a trailing slash resolves to the same landing page", () => {
  assert.equal(landingPageForPath("/draw-a-perfect-circle/")?.shape?.shapeId, "circle");
});

test("every single-shape landing page opens the shape it is about", () => {
  const expected: Record<string, string> = {
    "/draw-a-perfect-circle": "circle",
    "/draw-a-perfect-star": "star-5",
    "/draw-a-perfect-heart": "sym-heart",
  };
  for (const [path, shapeId] of Object.entries(expected)) {
    assert.equal(landingPageForPath(path)?.shape?.shapeId, shapeId, `${path} opens the wrong shape`);
  }
});

test("the deep-linked shapes exist in the real catalog", async () => {
  const { getShapeById } = await import("../engine/shapeLibrary.ts");
  for (const path of LANDING_PATHS) {
    const shape = landingPageForPath(path)?.shape;
    if (!shape) continue;
    const definition = getShapeById(shape.shapeId);
    assert.ok(definition, `${path} points at a shape that does not exist: ${shape.shapeId}`);
    assert.equal(definition.category, shape.category, `${path} names the wrong category for ${shape.shapeId}`);
  }
});

test("only a page dedicated to one out-of-reach shape asks for a practice round", () => {
  // The practice flag is the single unlock exception in the app (see
  // ShapeChallengeScreen.resolveInitialSelection). It must stay confined to the
  // shape pages that would otherwise land a new visitor on the category map -
  // never on the hub, and never on the circle, which needs no exception.
  const practicePaths = LANDING_PATHS.filter((path) => landingPageForPath(path)?.shape?.practice);
  assert.deepEqual(practicePaths.sort(), ["/draw-a-perfect-heart", "/draw-a-perfect-star"]);
});

test("the Google Play link is the app's real listing URL, not a second guess at it", async () => {
  // nativeShare.ts is the single source of truth (and its own test ties that
  // constant to the package id in capacitor.config.ts and build.gradle).
  const { PLAY_STORE_URL } = await import("../services/nativeShare.ts");
  assert.equal(SEO_PLAY_STORE_URL, PLAY_STORE_URL);
});

test("every landing page has one internal CTA and the Android line; the homepage has neither", () => {
  for (const path of WORKER_LANDING_PATHS) {
    const page = seoPageForPath(path)!;
    assert.ok(page.cta, `${path} has no CTA`);
    assert.equal(page.androidCta, true, `${path} is missing the Android line`);
  }
  const home = seoPageForPath("/")!;
  // The home screen already renders its own "Get the Android App" card, and the
  // game is right there on the page - a "play more" CTA would be circular.
  assert.equal(home.cta, undefined);
  assert.equal(home.androidCta, undefined);
});

test("CTA targets are real pages, never the page itself, and never repeated in its link list", () => {
  // Both halves of the public site count as real destinations: the game pages
  // here, and the standalone content pages the Worker serves (/how-to-play,
  // /about, /contact, /terms, /privacy - see worker/contentPages.ts).
  const knownPaths = new Set([...SEO_PAGES.map((page) => page.path), ...CONTENT_PATHS]);
  for (const page of SEO_PAGES) {
    // Every internal destination on the page: the practice group, the small link
    // list, and the CTA - each target may appear exactly once across all three.
    // A `#root` CTA is not a destination at all (it leads up to the app on this
    // same page), so it is checked separately below.
    const internalHrefs = [
      ...(page.linkGroup?.items ?? []).map((item) => item.href),
      ...page.links.map((link) => link.href),
      ...(page.cta && !page.cta.href.startsWith("#") ? [page.cta.href] : []),
    ];
    for (const href of internalHrefs) {
      assert.ok(knownPaths.has(href), `${page.path} links to unknown ${href}`);
      assert.notEqual(href, page.path, `${page.path} links to itself`);
    }
    assert.equal(new Set(internalHrefs).size, internalHrefs.length, `${page.path} shows the same destination twice`);
  }
});

test("a mode page sends its CTA to the game on that page, never back to Classic", () => {
  // The bug this pins down: both mode CTAs pointed at "/", so "Start a Game with
  // Friends" dropped the visitor on the Classic home screen. The app at the top
  // of a mode page is ALREADY that mode, so the CTA belongs to it.
  for (const path of ["/multiplayer-drawing-game", "/2-player-drawing-game-one-phone"]) {
    const landing = landingPageForPath(path)!;
    assert.ok(landing.mode, `${path} is expected to open a mode`);
    assert.equal(seoPageForPath(path)!.cta?.href, LANDING_CTA_HASH, `${path} CTA does not lead to the game on the page`);
  }
  // And the converse: only a page that opens a mode may use the in-page CTA.
  for (const page of SEO_PAGES) {
    if (page.cta?.href.startsWith("#")) {
      assert.ok(landingPageForPath(page.path)?.mode, `${page.path} has an in-page CTA but opens no mode`);
    }
  }
});

test("the CTA re-opens the mode when the app has drifted back to home", () => {
  // The bug: the fragment scrolls up to the app, and nothing more. A visitor who
  // pressed Back first was carried up to the HOME screen by a button that says
  // "Start a Two-Player Game" - the reported production failure.
  const twoPlayer = landingPageForPath("/2-player-drawing-game-one-phone")!;
  const multiplayer = landingPageForPath("/multiplayer-drawing-game")!;
  assert.equal(landingCtaMode(twoPlayer, "home"), "passPlay");
  assert.equal(landingCtaMode(multiplayer, "home"), "playTogether");

  // Already in the mode, or anywhere else the player went deliberately: the
  // button stays a scroll, so a match in progress is never thrown away.
  assert.equal(landingCtaMode(twoPlayer, "passPlay"), null);
  assert.equal(landingCtaMode(multiplayer, "playTogether"), null);
  assert.equal(landingCtaMode(twoPlayer, "shapeChallenge"), null);

  // Pages that open no mode, and plain app paths, have nothing to re-open.
  assert.equal(landingCtaMode(landingPageForPath("/draw-shapes-online")!, "home"), null);
  assert.equal(landingCtaMode(undefined, "home"), null);
});

test("the hub links to each individual shape page under a visible heading", () => {
  const hub = seoPageForPath("/draw-shapes-online")!;
  assert.equal(hub.linkGroup?.heading, "Practice individual shapes");
  assert.deepEqual(
    hub.linkGroup?.items.map((item) => item.href),
    ["/draw-a-perfect-circle", "/draw-a-perfect-star", "/draw-a-perfect-heart"],
  );
  // Every item carries its own anchor text and explanation - a bare list of
  // shape names is not a useful internal link.
  for (const item of hub.linkGroup!.items) {
    assert.ok(item.label.length > 0 && item.description.length > 20, `thin practice link: ${item.href}`);
  }
});

test("each shape page links back to the hub and to the other shape pages", () => {
  const shapePages = ["/draw-a-perfect-circle", "/draw-a-perfect-star", "/draw-a-perfect-heart"];
  for (const path of shapePages) {
    const page = seoPageForPath(path)!;
    const hrefs = [...page.links.map((link) => link.href), page.cta?.href];
    assert.ok(hrefs.includes("/draw-shapes-online"), `${path} does not link back to the hub`);
    for (const sibling of shapePages.filter((other) => other !== path)) {
      assert.ok(hrefs.includes(sibling), `${path} does not link to ${sibling}`);
    }
  }
});

test("the new shape pages each carry one crawlable image with a descriptive filename and alt", () => {
  for (const path of ["/draw-a-perfect-star", "/draw-a-perfect-heart"]) {
    const image = seoPageForPath(path)!.image!;
    assert.ok(image, `${path} has no image`);
    // The filename has to describe the picture, not just identify it.
    assert.match(image.src, /^\/images\/seo\/[a-z0-9-]+\.svg$/);
    assert.ok(image.src.includes(path.replace("/", "")), `${path} image filename does not name the page`);
    assert.ok(image.alt.length > 40, `${path} alt text is too thin to be descriptive`);
    assert.ok(image.caption.length > 0 && image.width > 0 && image.height > 0);
  }
});

test("the images the pages reference are really in public/", async () => {
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  for (const page of SEO_PAGES) {
    if (!page.image) continue;
    const file = fileURLToPath(new URL(`../../public${page.image.src}`, import.meta.url));
    assert.ok(existsSync(file), `missing asset for ${page.path}: public${page.image.src}`);
  }
});

test("the rendered copy block is crawlable HTML: real headings, links and image markup", () => {
  const star = renderSeoSection(seoPageForPath("/draw-a-perfect-star")!);
  assert.match(star, /<h1>Draw a Perfect Star<\/h1>/);
  assert.match(star, /<img src="\/images\/seo\/draw-a-perfect-star-[^"]+" alt="[^"]{40,}"/);
  assert.match(star, /<a href="\/draw-shapes-online">/);

  const hub = renderSeoSection(seoPageForPath("/draw-shapes-online")!);
  assert.match(hub, /<h2[^>]*>Practice individual shapes<\/h2>/);
  for (const href of ["/draw-a-perfect-circle", "/draw-a-perfect-star", "/draw-a-perfect-heart"]) {
    assert.match(hub, new RegExp(`<a href="${href}">`), `hub does not render a plain link to ${href}`);
  }
});

test("every page is in the sitemap exactly once, with its own canonical URL", () => {
  const sitemap = sitemapXml();
  for (const page of SEO_PAGES) {
    const loc = `<loc>${canonicalUrl(page.path)}</loc>`;
    assert.equal(sitemap.split(loc).length - 1, 1, `${page.path} is not in the sitemap exactly once`);
  }
  // No Disallow rule may match a page - robots.txt prefix semantics, so a rule
  // counts as blocking whenever the page path starts with it.
  const disallowed = robotsTxt()
    .split("\n")
    .filter((line) => line.startsWith("Disallow: "))
    .map((line) => line.slice("Disallow: ".length));
  for (const page of SEO_PAGES) {
    for (const rule of disallowed) {
      assert.ok(!page.path.startsWith(rule), `robots.txt rule "${rule}" blocks ${page.path}`);
    }
  }
});

// --- Wave 2: the two social modes -------------------------------------------
// Both target intents the SERP research showed CYDI actually matches. The head
// terms ("multiplayer drawing game", "drawing game with friends") are owned by
// draw-and-guess sites, so these pages have to say what they are in the first
// line rather than compete for a Pictionary intent CYDI does not serve.

test("each social mode has exactly one page, and neither targets the other's intent", () => {
  const mp = SEO_PAGES.find((p) => p.path === "/multiplayer-drawing-game");
  const tp = SEO_PAGES.find((p) => p.path === "/2-player-drawing-game-one-phone");
  assert.ok(mp && tp, "both social pages exist");

  // No keyword-variation pages: one per mode, no near-duplicate paths.
  const social = SEO_PAGES.filter((p) => /multiplayer|player|friends|phone/.test(p.path));
  assert.equal(social.length, 2, `expected 2 social pages, got ${social.map((p) => p.path).join(", ")}`);

  // The 2-player page must be unmistakably the same-device one, or it competes
  // with the multiplayer page for the same searchers.
  const tpText = `${tp!.title} ${tp!.h1} ${tp!.description}`.toLowerCase();
  assert.ok(/one phone|same device/.test(tpText), "the 2-player page must say it is one device");
  const mpText = `${mp!.title} ${mp!.h1} ${mp!.description}`.toLowerCase();
  assert.ok(!/one phone/.test(mpText), "the multiplayer page must not claim the same-device intent");
});

test("both social pages disambiguate themselves from draw-and-guess games", () => {
  for (const path of ["/multiplayer-drawing-game", "/2-player-drawing-game-one-phone"]) {
    const page = SEO_PAGES.find((p) => p.path === path)!;
    const opening = `${page.description} ${page.paragraphs[0]}`.toLowerCase();
    assert.ok(/same shape|from memory|guess/.test(opening), `${path} must say what it is up front`);
  }
});

test("the two social pages link to each other, and the hub links to both", () => {
  const mp = SEO_PAGES.find((p) => p.path === "/multiplayer-drawing-game")!;
  const tp = SEO_PAGES.find((p) => p.path === "/2-player-drawing-game-one-phone")!;
  assert.ok(mp.links.some((l) => l.href === tp.path), "multiplayer links to 2 players");
  assert.ok(tp.links.some((l) => l.href === mp.path), "2 players links to multiplayer");

  const hub = SEO_PAGES.find((p) => p.path === "/draw-shapes-online")!;
  for (const target of [mp.path, tp.path]) {
    assert.ok(hub.links.some((l) => l.href === target), `the hub links to ${target}`);
  }
});

test("a visitor from a social page lands in that mode, not on the shape map", () => {
  assert.equal(landingPageForPath("/multiplayer-drawing-game")?.mode, "playTogether");
  assert.equal(landingPageForPath("/2-player-drawing-game-one-phone")?.mode, "passPlay");
  // And the shape pages are untouched by the new field.
  assert.equal(landingPageForPath("/draw-a-perfect-circle")?.mode, undefined);
});
