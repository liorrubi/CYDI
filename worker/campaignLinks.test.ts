// Short campaign aliases. The property that matters most here is a negative one:
// /s/<anything> must never turn <anything> into a campaign, or our own analytics
// become writable by whoever guesses a URL.
import test from "node:test";
import assert from "node:assert/strict";

import { campaignLinkForPath, campaignRedirectUrl, CAMPAIGN_SLUGS } from "./campaignLinks.ts";
import { robotsTxt, sitemapXml, LANDING_PATHS } from "./seoPages.ts";
import { resolveAttribution } from "../src/services/analyticsAttribution.ts";

const ORIGIN = "https://playcydi.com";
const EXPECTED =
  "https://playcydi.com/draw-a-cat-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=28ntXVUs-cs";
const EXPECTED_DOG =
  "https://playcydi.com/draw-a-dog-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=n8aojqnxidc";
const EXPECTED_BEAR =
  "https://playcydi.com/draw-a-bear-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=OTByR2NtJk4";
const EXPECTED_OWL =
  "https://playcydi.com/draw-an-owl-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=FuEiFnzQuSY";
const EXPECTED_PIG =
  "https://playcydi.com/draw-a-pig-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=yfj8ZejJdVs";
const EXPECTED_SNAIL =
  "https://playcydi.com/draw-a-snail-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=w8zzhQOdSas";
const EXPECTED_STAR =
  "https://playcydi.com/draw-a-perfect-star?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=vcbiASLg-Gk";
const EXPECTED_LIGHTNING =
  "https://playcydi.com/draw-a-lightning-bolt-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=UWZ8uIOM3XU";
const EXPECTED_TRIANGLE =
  "https://playcydi.com/draw-a-triangle-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=ZbkTMF7LTTE";
const EXPECTED_GEAR =
  "https://playcydi.com/draw-a-gear-from-memory?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=bQG9L8gnRUQ";

test("/s/cat redirects to the fully tagged cat challenge", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/cat")), EXPECTED);
});

test("the alias is case-insensitive and tolerates a trailing slash", () => {
  for (const path of ["/s/CAT", "/s/Cat", "/s/cat/", "/s/cat//"]) {
    assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath(path)), EXPECTED, path);
  }
});

test("the redirect target resolves to exactly the intended attribution", () => {
  // Closing the loop: the URL this route produces is fed through the real landing
  // resolver, so the route and the attribution logic cannot drift apart.
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/cat")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "28ntXVUs-cs");
});

test("the creative id keeps its case and its hyphen through the whole round trip", () => {
  // A YouTube id is case-sensitive; lowercasing it anywhere would point the row at a
  // different video. 28ntXVUs-cs opens with digits, carries a capital run and ends in a
  // hyphenated tail - three things a slug helper or a hand-typed copy tends to destroy.
  assert.ok(EXPECTED.includes("utm_content=28ntXVUs-cs"));
  assert.equal(CAMPAIGN_SLUGS.cat.content, "28ntXVUs-cs");
});

test("the cat alias points at the Cat Short, not the Short it used to name", () => {
  // Until 22 Sep 2026 this mapping carried N4H7VTj59A0, which is a DIFFERENT published
  // Short ("Can You Beat This Score?"), so every /s/cat click was attributed to the
  // wrong creative. This test exists to stop that id ever coming back.
  assert.equal(CAMPAIGN_SLUGS.cat.content, "28ntXVUs-cs");
  assert.notEqual(CAMPAIGN_SLUGS.cat.content, "N4H7VTj59A0");
  for (const [slug, link] of Object.entries(CAMPAIGN_SLUGS)) {
    assert.notEqual(link.content, "N4H7VTj59A0", `${slug} must not use the retired id`);
  }
});

test("every alias names a distinct creative", () => {
  // Two slugs sharing a video id is how the cat mix-up would have been caught earlier.
  const ids = Object.values(CAMPAIGN_SLUGS).map((l) => l.content);
  assert.equal(new Set(ids).size, ids.length, "two aliases point at the same video id");
});

test("/s/dog lands on the dog challenge page, tagged, not on the homepage", () => {
  // The point of this alias: someone who just watched the Dog Short gets the dog
  // challenge itself, not a home screen they then have to navigate.
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/dog")), EXPECTED_DOG);
  assert.equal(new URL(EXPECTED_DOG).pathname, "/draw-a-dog-from-memory");
});

test("/s/dog resolves to exactly the Dog Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/dog")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "n8aojqnxidc");
});

test("a landing path is only ever taken from the map", () => {
  // Every alias lands on the challenge its Short was about - the cat's page was
  // added after its Short, so this one moved off the homepage deliberately. Its
  // tags did not change with it.
  assert.equal(CAMPAIGN_SLUGS.cat.path, "/draw-a-cat-from-memory");
  assert.equal(CAMPAIGN_SLUGS.cat.content, "28ntXVUs-cs");
  // And every path in the map is one of our own landing pages, never an off-site URL.
  for (const [slug, link] of Object.entries(CAMPAIGN_SLUGS)) {
    if (link.path === undefined) continue;
    assert.ok(link.path.startsWith("/"), `${slug} path is not site-relative`);
    assert.ok(!link.path.startsWith("//"), `${slug} path could leave the site`);
    assert.ok(LANDING_PATHS.includes(link.path), `${slug} points at ${link.path}, which is not a landing page`);
  }
});

// --- The negative half ---

test("an unknown slug produces no campaign at all", () => {
  for (const path of ["/s/unknown", "/s/bird", "/s/", "/s/cydi_shorts", "/s/N4H7VTj59A0"]) {
    assert.equal(campaignLinkForPath(path), null, path);
    const url = campaignRedirectUrl(ORIGIN, campaignLinkForPath(path));
    assert.equal(url, "https://playcydi.com/", path);
    assert.ok(!url.includes("utm_"), `${path} must not carry any tag`);
  }
});

test("an unknown slug cannot smuggle its own text into the tags", () => {
  const hostile = "/s/" + encodeURIComponent("evil&utm_campaign=hijacked");
  const url = campaignRedirectUrl(ORIGIN, campaignLinkForPath(hostile));
  assert.equal(url, "https://playcydi.com/");
  assert.ok(!url.includes("hijacked"));
});

test("inherited object keys are not campaigns", () => {
  // A plain-object map would answer /s/constructor with Object.prototype.constructor.
  for (const path of ["/s/constructor", "/s/__proto__", "/s/tostring", "/s/hasownproperty"]) {
    assert.equal(campaignLinkForPath(path), null, path);
  }
});

test("paths that merely start with s are not aliases", () => {
  for (const path of ["/", "/shapes", "/s", "/sitemap.xml", "/how-to-play", "/c/abc123"]) {
    assert.equal(campaignLinkForPath(path), null, path);
  }
});

test("/s/bear lands on the bear challenge page, tagged, not on the homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/bear")), EXPECTED_BEAR);
  assert.equal(new URL(EXPECTED_BEAR).pathname, "/draw-a-bear-from-memory");
});

test("/s/bear resolves to exactly the Bear Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/bear")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "OTByR2NtJk4");
});

test("the bear creative id keeps its case", () => {
  // OTByR2NtJk4 - two capitals in a row and a lone lowercase y. Lowercasing it
  // anywhere would point the analytics row at a video that does not exist.
  assert.equal(CAMPAIGN_SLUGS.bear.content, "OTByR2NtJk4");
  assert.ok(EXPECTED_BEAR.includes("utm_content=OTByR2NtJk4"));
});

test("/s/owl lands on the owl challenge page, tagged, not on the homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/owl")), EXPECTED_OWL);
  assert.equal(new URL(EXPECTED_OWL).pathname, "/draw-an-owl-from-memory");
});

test("/s/owl resolves to exactly the Owl Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/owl")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "FuEiFnzQuSY");
});

test("the owl creative id keeps its case", () => {
  // FuEiFnzQuSY alternates case in a way no reader would reproduce from a screenshot.
  assert.equal(CAMPAIGN_SLUGS.owl.content, "FuEiFnzQuSY");
  assert.ok(EXPECTED_OWL.includes("utm_content=FuEiFnzQuSY"));
});

test("/s/pig lands on the pig challenge page, tagged, not on the homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/pig")), EXPECTED_PIG);
  assert.equal(new URL(EXPECTED_PIG).pathname, "/draw-a-pig-from-memory");
});

test("/s/pig resolves to exactly the Pig Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/pig")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "yfj8ZejJdVs");
});

test("the pig creative id keeps its case", () => {
  // yfj8ZejJdVs - three capitals scattered through it, and a digit that reads as a
  // letter at small sizes. Exactly the string a screenshot gets wrong.
  assert.equal(CAMPAIGN_SLUGS.pig.content, "yfj8ZejJdVs");
  assert.ok(EXPECTED_PIG.includes("utm_content=yfj8ZejJdVs"));
});

test("/s/snail lands on the snail challenge page, tagged, not on the homepage", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/snail")), EXPECTED_SNAIL);
  assert.equal(new URL(EXPECTED_SNAIL).pathname, "/draw-a-snail-from-memory");
});

test("/s/snail resolves to exactly the Snail Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/snail")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "w8zzhQOdSas");
});

test("the snail creative id keeps its case", () => {
  // w8zzhQOdSas - a lone capital Q and O inside a run of lowercase, next to a digit.
  assert.equal(CAMPAIGN_SLUGS.snail.content, "w8zzhQOdSas");
  assert.ok(EXPECTED_SNAIL.includes("utm_content=w8zzhQOdSas"));
});

test("/s/star lands on the existing star challenge page, tagged", () => {
  // The only alias so far whose destination was already an indexed page of its own
  // before the Short existed - the mapping must point at it, not mint a new path.
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/star")), EXPECTED_STAR);
  assert.equal(new URL(EXPECTED_STAR).pathname, "/draw-a-perfect-star");
});

test("/s/star resolves to exactly the Star Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/star")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "vcbiASLg-Gk");
});

test("the star creative id keeps its case and its hyphen", () => {
  // vcbiASLg-Gk - two capital runs and a hyphen, which a lowercasing slug helper
  // or a screenshot read would both destroy.
  assert.equal(CAMPAIGN_SLUGS.star.content, "vcbiASLg-Gk");
  assert.ok(EXPECTED_STAR.includes("utm_content=vcbiASLg-Gk"));
});

test("/s/lightning lands on the lightning challenge page, tagged", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/lightning")), EXPECTED_LIGHTNING);
  assert.equal(new URL(EXPECTED_LIGHTNING).pathname, "/draw-a-lightning-bolt-from-memory");
});

test("/s/lightning resolves to exactly the Lightning Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/lightning")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "UWZ8uIOM3XU");
});

test("the lightning creative id keeps its case", () => {
  // UWZ8uIOM3XU - three capital runs around a lone lowercase u, and an O next to a
  // digit. Exactly the string a lowercasing helper or a screenshot read gets wrong.
  assert.equal(CAMPAIGN_SLUGS.lightning.content, "UWZ8uIOM3XU");
  assert.ok(EXPECTED_LIGHTNING.includes("utm_content=UWZ8uIOM3XU"));
});

test("/s/triangle lands on the triangle challenge page, tagged", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/triangle")), EXPECTED_TRIANGLE);
  assert.equal(new URL(EXPECTED_TRIANGLE).pathname, "/draw-a-triangle-from-memory");
});

test("/s/triangle resolves to exactly the Triangle Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/triangle")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "ZbkTMF7LTTE");
});

test("the triangle creative id keeps its case", () => {
  // ZbkTMF7LTTE - a run of four capitals with a digit inside it, then three more.
  // Lowercasing any of them points the row at a video that does not exist.
  assert.equal(CAMPAIGN_SLUGS.triangle.content, "ZbkTMF7LTTE");
  assert.ok(EXPECTED_TRIANGLE.includes("utm_content=ZbkTMF7LTTE"));
});

test("/s/gear lands on the gear challenge page, tagged", () => {
  assert.equal(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/gear")), EXPECTED_GEAR);
  assert.equal(new URL(EXPECTED_GEAR).pathname, "/draw-a-gear-from-memory");
});

test("/s/gear resolves to exactly the Gear Short's attribution", () => {
  const target = new URL(campaignRedirectUrl(ORIGIN, campaignLinkForPath("/s/gear")));
  const attribution = resolveAttribution({ search: target.search, referrer: "", origin: ORIGIN });
  assert.equal(attribution.source, "youtube");
  assert.equal(attribution.medium, "shorts");
  assert.equal(attribution.campaign, "cydi_shorts");
  assert.equal(attribution.content, "bQG9L8gnRUQ");
});

test("the gear creative id keeps its case", () => {
  // bQG9L8gnRUQ - capitals and lowercase alternating around two digits. Lowercasing
  // it anywhere points the row at a video that does not exist.
  assert.equal(CAMPAIGN_SLUGS.gear.content, "bQG9L8gnRUQ");
  assert.ok(EXPECTED_GEAR.includes("utm_content=bQG9L8gnRUQ"));
});

test("campaign aliases are kept out of the index", () => {
  assert.ok(robotsTxt().includes("Disallow: /s/"));
});

test("no campaign alias ever reaches the sitemap", () => {
  // An alias is a redirect, not a page: it must not be crawlable and must not be
  // offered for indexing, however many of them the map grows to.
  const xml = sitemapXml();
  assert.ok(!xml.includes("/s/"), "sitemap must not contain the alias prefix");
  for (const slug of Object.keys(CAMPAIGN_SLUGS)) {
    assert.ok(!xml.includes(`/s/${slug}`), `/s/${slug} must not be in the sitemap`);
  }
});

test("every configured slug is a usable, typeable alias", () => {
  // The whole point is a URL someone can read off a screen and type correctly.
  for (const [slug, link] of Object.entries(CAMPAIGN_SLUGS)) {
    assert.match(slug, /^[a-z0-9-]{1,16}$/, `slug "${slug}" must be short and lowercase`);
    assert.equal(campaignLinkForPath("/s/" + slug), link);
    for (const field of ["source", "medium", "campaign", "content"] as const) {
      assert.ok(link[field].length > 0, `${slug}.${field} must be set`);
    }
  }
});
