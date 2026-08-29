# design-sync notes — CYDI

Repo-specific gotchas for future syncs. Read this before re-running.

## Shape: this repo is an app, not a component library

- CYDI has **no library build and no package entry** (`private: true`, no
  `main`/`module`/`exports`; `dist/` is the built *game site*, not a library).
  The converter's synth entry uses `export *`, which does **not** carry default
  exports — and every CYDI component is a default export — so without help the
  whole bundle exports nothing.
- Fix: **`.design-sync/entry.tsx`** is a hand-written barrel that re-exports each
  scoped component as a named export. It is passed via `--entry`. Keep it in sync
  with `componentSrcMap` in `config.json` (both list the same components; the map
  is what makes the converter emit a card per component, the barrel is what puts
  them on `window.Cydi`).

## Required build step: the `types/` tree

- `buildCmd` is `npx tsc -p .design-sync/tsconfig.types.json`, which emits a
  declaration tree into **`types/`** at the repo root. The repo's own tsconfig is
  `noEmit`, so this is the only source of `.d.ts`.
- This matters a lot: `findTypesRoot` picks up `types/` automatically, and
  without it every emitted `<Name>.d.ts` degrades to `[key: string]: unknown` —
  i.e. the design agent gets no prop contract at all. **Always run `buildCmd`
  before the converter.**
- `types/` is generated and gitignored.

## Vite `define` globals

- `vite.config.ts` injects `__APP_BUILD__` and `__APP_BUILD_TIME__`, and
  `src/app/constants.ts` reads them at module top level. Under esbuild they are
  undefined and the bundle throws `ReferenceError: __APP_BUILD__ is not defined`
  before anything reaches `window.Cydi`.
- Fix: **`.design-sync/ds-globals.ts`**, imported first by `entry.tsx`. The
  converter has no config key for esbuild `define`, so this shim is the
  mechanism. Its values are **fixed literals on purpose** — deriving them from
  git or the clock would change the bundle hash on every build and invalidate
  every render hash in the verification anchor.

## Dropbox: build output must live outside the repo

- The repo is Dropbox-synced. `package-build.mjs` starts by `rm -rf`ing its
  `--out` dir, which fails with **`EPERM`** on a Dropbox-locked directory —
  reproducibly, not transiently (retrying did not clear it).
- Fix: build to **`%LOCALAPPDATA%\ds-sync\cydi\ds-bundle`**, outside Dropbox.
  Same rationale as `cacheDir` in `cydi/vite.config.ts` (see the root CLAUDE.md).
  Use that path for `--out`, for `package-validate.mjs`/`package-capture.mjs`,
  and as `localDir` at upload.

## Scope

- Synced set is the **presentational** components (19). Deliberately excluded:
  `DrawingCanvas`, `ShapeOverlayCanvas`, the tutorial/reward/menu overlays,
  `ResumeGameBanner`, `DoubleCoinsOffer` — they need live game state, sockets or
  ad SDKs and would render as empty cards.
- `ChampionBadge` is in the bundle but **stays on the floor card by design**: it
  returns `null` until the player completes the Mega Album, so it cannot render
  statically without seeding the whole mega-card save state. Not a failure.

## Preview techniques worth reusing

- **Seeding save state:** `CoinIndicator` reads coins from the save store, not
  props. Its preview writes `localStorage["cydi.save.v1"] = {"progress":{"coins":1240}}`
  at module scope before React renders. `saveStore.normalize` merges a partial
  `progress` over defaults, so only the fields you care about are needed.
- **Fixed-position overlays:** `AchievementUnlockedBanner` is
  `position: fixed; inset: 0` and escaped its preview card (cropped, no backdrop).
  Raising the `viewport` override did **not** help. The fix that worked: wrap it
  in a `transform: translateZ(0)` stage — a transformed ancestor becomes the
  containing block for fixed positioning, bounding the overlay to a phone-sized
  frame. Reuse this for any other fixed overlay brought into scope later.
- `.shape-icon` sets `color` on the element itself, so `ShapePreviewIcon` does
  **not** inherit a parent's `color`. Recolor it by overriding `--color-primary`
  on an ancestor.

## Known render warns (expected — not new)

- `[FONT_MISSING] "Cascadia Mono"` — accepted by the owner on 2026-08-29. CYDI
  has **no brand webfont**; every family is a system stack
  (`-apple-system`/`Segoe UI`, Georgia, `ui-monospace`), and the stacks already
  degrade cleanly. Do not wire `extraFonts` for this.
- `tokens: 1 missing, below threshold` — benign.

## Re-sync risks

- **The barrel and the config can drift.** Adding a component to
  `componentSrcMap` without adding it to `entry.tsx` yields a card whose
  component is `undefined` on `window.Cydi`. Always edit both.
- **`types/` can go stale.** It is gitignored and regenerated only by `buildCmd`.
  A sync that skips it silently ships weaker `.d.ts` contracts than the last one.
  If prop bodies come back as `[key: string]: unknown`, this is why.
- **Preview fixtures are hand-written copies of repo types** (`ScoreBreakdown`,
  `Challenge`, `Achievement`, `ArtistPackDefinition`, `DailyLeaderboardEntry`).
  If those types change, the previews will still compile (esbuild does not
  type-check) but may render wrong. Re-read the types when a preview looks off.
- **The save-state seed in `CoinIndicator.tsx` depends on the save schema**
  (`cydi.save.v1`, `progress.coins`). A schema-version bump will silently drop it
  back to zero coins.
- **Not verified:** dark mode. Every card was captured in light mode only. The
  tokens are defined for `:root[data-theme="dark"]`, but no preview was rendered
  under it.
- Toolchain used: Node v24.18.0, playwright chromium-1234, installed into
  `.ds-sync/` (not the repo's own dependencies).

## Upload — first completed sync (2026-08-29)

- Target project: **CYDI Design System**,
  `c0f1b03c-de60-4a0f-afc3-d829e6586886`, now pinned as `projectId` in
  `config.json`. 102 files uploaded (bundle, styles, README, anchor, 2 vendor,
  18 previews, 19 component folders × 4).
- **The run before this one built and verified everything but never uploaded** —
  it died before a project was ever created, leaving a `config.json` with no
  `projectId`. If that state recurs (config present, `projectId` absent), the
  build in `%LOCALAPPDATA%\ds-sync\cydi\ds-bundle` is likely already green:
  check `.resync-verdict.json` before rebuilding from scratch.
- `tokens/` and `guidelines/` build empty and there is no `fonts/` dir — correct
  for CYDI (no brand webfont, no token-export step). Not a missing step.
- The only other design-system project on this account is **"Design System"**,
  owned by a different person. Do not sync into it.

## Finding: `Button`'s emitted `.d.ts` under-declares its API

- `src/components/Button.tsx` is
  `ButtonHTMLAttributes<HTMLButtonElement> & { variant? }`, but the converter
  **flattens the inherited HTML attributes away**: the emitted `ButtonProps` is
  only `className`, `id`, `style`, `children`, `variant`. So `onClick`,
  `disabled`, `type` and `aria-*` are absent from the contract even though the
  component spreads `...rest` onto the real `<button>` and they work fine.
- This is a converter limitation, not a bug in `conventions.md` — the header's
  `onClick` snippet is valid, working code, and the generated
  `Button.prompt.md` example itself uses `disabled`. Left as-is deliberately.
- **`Button` is the only affected component** — it is the only one in the synced
  set that extends an HTML/SVG attributes type (verified by grep over
  `src/components`). If another component is written that way, expect the same
  narrowing.

## This machine: the auto-mode classifier blocks some Bash

- Inline `node -e "..."` and multi-command Bash pipelines (`for` loops, `du`,
  `find -printf`) were **denied by the auto-mode classifier** during this sync.
  Plain `cat`/`ls`/`git diff` are fine. Use the Read/Edit/Glob/Grep tools for
  file inspection and edits instead of shelling out — that path is not blocked.
