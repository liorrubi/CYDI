// The scored examples on the deepened challenge pages are precomputed: the page
// shows committed numbers and a committed image, and never runs the scorer. These
// tests are what keeps "precomputed" honest - the committed files must be exactly
// what the real scorer produces today, and nothing a page loads may import it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { SCORED_EXAMPLE_DEFINITIONS, computeScoredExample, scoredExampleSvg, scoredExamplesDataModule } = await import(
  "./scoredExamples.ts"
);
const { SCORED_EXAMPLES } = await import("./scoredExamplesData.ts");
const { CHALLENGE_PAGE_COPY } = await import("./challengePageCopy.ts");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

test("the committed numbers are exactly what the scorer produces today", () => {
  assert.equal(
    read("src", "content", "scoredExamplesData.ts"),
    scoredExamplesDataModule(),
    "stale - run: node --import ./scripts/register-ts.mjs scripts/generateScoredExamples.ts",
  );
});

test("the committed overlays are exactly what the generator draws today", () => {
  for (const definition of SCORED_EXAMPLE_DEFINITIONS) {
    const file = `${definition.imageSlug}-scored-example.svg`;
    assert.equal(read("public", "images", "seo", file), scoredExampleSvg(definition), `${file} is stale`);
  }
});

test("every page with a deep dive has a scored example, and only those", () => {
  const withDeepDive = CHALLENGE_PAGE_COPY.filter((copy) => copy.deepDive).map((copy) => copy.path).sort();
  assert.deepEqual(SCORED_EXAMPLES.map((example) => example.path).sort(), withDeepDive);
  assert.ok(withDeepDive.length >= 4 && withDeepDive.length <= 5, "the deep dive is scoped to 4-5 pages");
});

test("each signature mistake costs points against the same hand without it", () => {
  for (const definition of SCORED_EXAMPLE_DEFINITIONS) {
    const [baseline, ...mistakes] = computeScoredExample(definition).rows;
    assert.ok(baseline.total >= 85, `${definition.path}: the clean attempt should score well (${baseline.total})`);
    for (const mistake of mistakes) {
      assert.ok(mistake.total < baseline.total - 10, `${definition.path}: "${mistake.label}" should cost real points`);
    }
  }
});

test("part shares cover the whole shape", () => {
  for (const example of SCORED_EXAMPLES) {
    const sum = example.partShares.reduce((total, part) => total + part.percent, 0);
    assert.ok(sum >= 98 && sum <= 102, `${example.path}: shares sum to ${sum}%`);
  }
});

test("nothing a page loads imports the scorer or the build-time module", () => {
  for (const file of [
    ["src", "content", "scoredExamplesData.ts"],
    ["src", "content", "challengePageCopy.ts"],
    ["src", "site", "SeoPracticePage.tsx"],
    ["worker", "seoPages.ts"],
  ]) {
    const source = read(...file);
    assert.doesNotMatch(source, /from ["'][^"']*engine\/scoring["']/, `${file.join("/")} imports the scorer`);
    assert.doesNotMatch(source, /from ["'][^"']*\/scoredExamples["']/, `${file.join("/")} imports the build-time module`);
  }
});
