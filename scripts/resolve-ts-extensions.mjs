// Node's ESM loader requires explicit file extensions on relative imports, but
// the app source uses extensionless specifiers (resolved by Vite's bundler mode
// at build time). This resolve hook lets `node --test` load that source as-is by
// appending `.ts`/`.tsx` (or `/index.ts`) to extensionless relative specifiers
// when a matching file exists. It only affects test runs; the real build is
// untouched.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
  if (isRelative && !hasExtension && context.parentURL) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = new URL(specifier + suffix, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return next(specifier + suffix, context);
      }
    }
  }
  return next(specifier, context);
}
