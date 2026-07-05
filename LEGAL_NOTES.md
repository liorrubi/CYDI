# Legal Notes

## Project name

**CYDI** is a working codename only. No trademark clearance has been performed.

A preliminary search found a cancelled CYDI trademark record and the unrelated Cydia
ecosystem. This is **not** legal clearance and must never be represented as such in
the app, documentation, or marketing. Professional trademark clearance for relevant
classes and jurisdictions is required before any commercial release.

The brand name is centralized in `src/app/constants.ts` (`APP_NAME`) so it can be
renamed easily if needed.

## Copyright and IP

This project uses only:

- Original CSS/SVG/canvas visuals, built for this project.
- System fonts and emoji glyphs (e.g. 🔒, 🔊) rendered by the OS/browser, not custom artwork.
- Sounds synthesized at runtime via the Web Audio API (oscillator tones) - no
  audio samples, recordings, or third-party sound effects are used anywhere.
- Original copywriting.
- User-generated freehand drawings (created by the player at runtime).
- The default Vite/React scaffold's build tooling (not its branding, which has been
  removed).

This project does **not** use:

- Any third-party logos, mascots, or artwork.
- Any existing game's name, branding, or visual identity.
- Any third-party image or audio assets.
- Any UI layout intentionally imitating a specific existing game or app.

## Before commercial release

- Perform professional trademark clearance.
- Re-confirm no dependency has been added under a non-permissive license.
- Review this file for updates as the product evolves.
