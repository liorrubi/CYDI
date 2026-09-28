/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Regenerates the scored examples on the deepened challenge pages:
//   src/content/scoredExamplesData.ts          - the numbers pages read
//   public/images/seo/<page>-scored-example.svg - the overlay each page shows
//
// Run after changing the scorer, a shape generator or scoredExamples.ts:
//   node --import ./scripts/register-ts.mjs scripts/generateScoredExamples.ts
// src/content/scoredExamples.test.ts fails until you do.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCORED_EXAMPLE_DEFINITIONS, scoredExampleSvg, scoredExamplesDataModule } from "../src/content/scoredExamples.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

writeFileSync(join(ROOT, "src", "content", "scoredExamplesData.ts"), scoredExamplesDataModule(), "utf8");
for (const definition of SCORED_EXAMPLE_DEFINITIONS) {
  const file = join(ROOT, "public", "images", "seo", `${definition.imageSlug}-scored-example.svg`);
  writeFileSync(file, scoredExampleSvg(definition), "utf8");
}
console.log(`wrote scoredExamplesData.ts and ${SCORED_EXAMPLE_DEFINITIONS.length} overlays`);
