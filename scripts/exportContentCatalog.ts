/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// CLI: exports the baked-in content as a publishable JSON catalog.
//
//   npm run export-catalog                  -> content-catalog/catalog.json
//   npm run export-catalog -- 42            -> explicit contentVersion 42
//
// contentVersion defaults to the current unix time in seconds, which is
// strictly increasing across runs; pass an explicit integer to control it
// (e.g. when re-publishing an old catalog as a rollback).
//
// Publish (staging/local): PUT the file to /api/content/catalog with the
// admin token - see worker/index.ts. Rollback = re-publish a previous file.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogFromLocalContent } from "../src/content/exportCatalog.ts";

const explicit = process.argv[2] ? Number(process.argv[2]) : undefined;
if (explicit !== undefined && (!Number.isInteger(explicit) || explicit <= 0)) {
  console.error(`contentVersion must be a positive integer, got: ${process.argv[2]}`);
  process.exit(1);
}
const contentVersion = explicit ?? Math.floor(Date.now() / 1000);

const catalog = buildCatalogFromLocalContent(contentVersion);
const json = JSON.stringify(catalog);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "content-catalog");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "catalog.json");
writeFileSync(outFile, json);

console.log(
  `wrote ${outFile}\n` +
    `contentVersion=${catalog.contentVersion} categories=${catalog.categories.length} ` +
    `shapes=${catalog.shapes.length} bytes=${Buffer.byteLength(json)}`,
);
