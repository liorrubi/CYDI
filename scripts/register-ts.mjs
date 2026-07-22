// Registers the TS-extension resolve hook for `node --test` (see
// resolve-ts-extensions.mjs). Used via `node --import ./scripts/register-ts.mjs`.
import { register } from "node:module";

register("./resolve-ts-extensions.mjs", import.meta.url);

// Vite injects these via `define` at build time; under plain Node they don't
// exist, which would crash any test that (transitively) imports
// src/app/constants.ts. Provide test-only stand-ins.
globalThis.__APP_BUILD__ ??= "test";
globalThis.__APP_BUILD_TIME__ ??= "1970-01-01T00:00:00.000Z";
