# Changelog

## 0.1.0 - 2026-07-05

Initial CYDI MVP: local-only Create Challenge loop.

- Scaffolded fresh with Vite + React + TypeScript.
- Added a shape-agnostic vector-based scoring engine (`src/engine/`): path
  normalization (dedupe, arc-length resample, center, scale), point-array
  comparison with reverse-direction handling, and closed-shape rotational
  start-point search.
- Added `localStorage`-backed challenge persistence (`src/services/challengeStorage.ts`)
  under the `cydi.challenges.v1` key, with defensive parsing so corrupt data
  never crashes the app.
- Added Home, Create Challenge, My Challenges, and Play Challenge (with an
  embedded Result state) screens, wired together with simple state-based
  routing (no router dependency).
- Added a shared `DrawingCanvas` component supporting mouse/touch/pen input,
  a fixed single continuous stroke, and an optional ghost-preview overlay
  reused for the pre-attempt "study the shape" phase.
- Added `LEGAL_NOTES.md` documenting IP/trademark guardrails.
