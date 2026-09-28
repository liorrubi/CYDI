// The challenge pages' own copy is shared by the Worker's crawlable block and the
// rendered practice page (see challengePageCopy.ts). These tests hold the two
// together: every page the app renders as a practice page has copy, and the
// Worker indexes exactly those sentences.
import test from "node:test";
import assert from "node:assert/strict";

const { CHALLENGE_PAGE_COPY, challengePageCopyForPath } = await import("./challengePageCopy.ts");
const { LANDING_PATHS, landingPageForPath } = await import("../seo/landingPages.ts");
const { seoPageForPath } = await import("../../worker/seoPages.ts");

const practicePaths = LANDING_PATHS.filter((path) => landingPageForPath(path)?.shape);

test("every landing path that opens a practice page has its own copy, and nothing else does", () => {
  assert.deepEqual(CHALLENGE_PAGE_COPY.map((copy) => copy.path).sort(), [...practicePaths].sort());
});

test("the Worker indexes the same heading, sentences and diagram the page renders", () => {
  for (const copy of CHALLENGE_PAGE_COPY) {
    const page = seoPageForPath(copy.path);
    assert.ok(page, copy.path);
    assert.equal(page.h1, copy.heading, copy.path);
    assert.deepEqual(page.paragraphs.slice(0, copy.paragraphs.length), copy.paragraphs, copy.path);
    assert.deepEqual(page.image, copy.image, copy.path);
  }
});

test("each page has a lede and a detail section of its own", () => {
  const leads = new Set<string>();
  const headings = new Set<string>();
  for (const copy of CHALLENGE_PAGE_COPY) {
    assert.ok(copy.paragraphs.length >= 2, `${copy.path} needs a lede and at least one detail paragraph`);
    assert.ok(!leads.has(copy.paragraphs[0]), `${copy.path} shares its lede`);
    assert.ok(!headings.has(copy.detailHeading), `${copy.path} shares its detail heading`);
    leads.add(copy.paragraphs[0]);
    headings.add(copy.detailHeading);
  }
});

test("lookup ignores a trailing slash and misses cleanly", () => {
  assert.equal(challengePageCopyForPath("/draw-a-perfect-circle/")?.heading, "Draw a Perfect Circle");
  assert.equal(challengePageCopyForPath("/drawing-challenges"), undefined);
});
