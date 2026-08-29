/*
 * Vite `define` stand-ins for the design-sync bundle.
 *
 * vite.config.ts injects __APP_BUILD__ / __APP_BUILD_TIME__ at build time, and
 * src/app/constants.ts reads them at module top level - so without these the
 * whole bundle throws "ReferenceError: __APP_BUILD__ is not defined" before a
 * single component reaches window.Cydi.
 *
 * Values are fixed literals, not derived from git or the clock: the converter
 * hashes the bundle for its verification anchor, so a value that changes per
 * build would invalidate every render hash on every sync.
 *
 * Imported first by entry.tsx - ES modules evaluate imports in source order,
 * so this runs before any component module.
 */
const g = globalThis as unknown as Record<string, string>;
g.__APP_BUILD__ = "design-sync";
g.__APP_BUILD_TIME__ = "2026-01-01T00:00:00.000Z";
export {};
