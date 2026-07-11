# Changelog

## 0.17.1 - 2026-07-11

"Nimco Design" now shows a real profile photo instead of the generic 🎨 emoji,
on both its Artist Packs card and its pack page. The photo is a square/circular
crop (cropped, never stretched) served from `public/images/artists/`, sharp on
retina/mobile, with accessible alt text "Nimco Design". `ArtistProfile` gained
optional `avatarImageUrl` / `avatarImageAlt` fields (falling back to
`avatarIcon` when unset), used by `ArtistPackCard.tsx` and `ArtistPackScreen.tsx`.

## 0.17.0 - 2026-07-11

Shop chest keys now have a **per-tier purchase cooldown**: buying a chest tier
(Iron/Copper/Silver/Gold/Platinum) locks that same tier out for 60 minutes -
other tiers stay independently purchasable on their own timers. The Buy button
shows a live `MM:SS` countdown and re-enables itself automatically the instant
the cooldown ends, no refresh needed. The cooldown is re-checked at the moment
of the click (before any coins are spent or reward rolled) to prevent
double-spends from stale UI state or rapid double-clicks, and the per-tier
"available again at" timestamps are stored in the central save data so the
lockout survives a refresh or restart. The free Daily Chest is untouched by
this change. (`src/screens/ShopScreen.tsx`, `src/services/chestCooldownStore.ts`,
`src/services/saveData.ts`)

Also: "Nimco Design"'s traced portrait ("Portrait Study") is now owner-approved
and published, so the Artist Packs section shows it as a real, openable pack
instead of the "Coming Soon" placeholder card. (`src/engine/artistPackLibrary.ts`)

## 0.16.1 - 2026-07-11

Artist Packs visibility tweak: the Artist Packs section and each pack card now
always show in production, even before a pack has any published artwork. A pack
with nothing published renders as a disabled **"Coming Soon"** card (no arrow, no
progress bar) that players cannot open. The published-only guarantees are
unchanged and still enforced: only `published` artwork can ever be displayed,
opened, shared, drawn, scored, or reached by direct navigation; unpublished
artwork stays out of the production bundle. In development the Coming Soon card
remains openable so the owner can still review drafts. "Nimco Design" therefore
now appears as a Coming Soon card (its portrait stays `draft`, unpublished).

## 0.16.0 - 2026-07-11

Introduced **Artist Packs** - themed drawing-challenge packs built around a real
artist, shown in their own section beneath the normal categories on the Shape
Challenge screen (not as a regular category or a separate game mode). Each pack
has an artist profile (name, avatar, short bio, external website link) and its
artworks each carry a visible credit line. New files: `src/engine/artistPackLibrary.ts`
(pack/artwork data + filtering helpers), `src/services/artistPackStore.ts`
(per-artwork best scores), `src/screens/ArtistPackScreen.tsx` (pack detail + draw
flow), and `src/components/ArtistPackCard.tsx` (entry card), wired through a new
`artistPack` route (`routes.ts`, `GameMode.ts`, `App.tsx`) and section in
`ShapeChallengeScreen.tsx`. Packs are always free - there is no unlock cost,
purchase, or coin charge.

Owner-controlled publishing is built in: every artwork has an explicit
`draft` / `approved` / `published` status, and **only `published` artwork is ever
shown to or opened by players**. Unpublished artwork is excluded from the
production bundle entirely (tree-shaken via a dev-only guard) and is visible only
in development for review; a pack with no published artwork stays hidden from
players. There is intentionally no in-app upload, runtime image conversion, admin
panel, or automatic publishing - artwork is authored offline and added as data.

On an Artist Pack result screen, players can now **Share** their score (challenge
name, score, pack name, and artist credit, via CYDI's existing share sheet), and
during drawing they can toggle **Show Guide** to keep the target outline visible
as a non-interactive overlay (it never becomes part of the drawing; scoring is
unchanged). The first pack, "Nimco Design" (Nimrod Cohen), ships with no published
artwork yet, so it is not player-facing.

The data model reserves optional per-artist affiliate fields (`affiliateUrl`,
`affiliateLinkId`) and emits an `artist_pack_link_clicked` analytics event, so an
affiliate program can be switched on later with no structural or UI change; the
outbound link uses the configured affiliate URL verbatim, otherwise the artist's
website.

## 0.15.0 - 2026-07-10

Added a provider-agnostic analytics foundation, designed so a future Android/Google
Play build can plug in Firebase Analytics or GA4 without touching any game code.
All game code now calls one function, `trackEvent(eventName, params)` in the new
`src/services/analytics.ts`, instead of ever calling a provider SDK directly. Today
it ships with no real backend registered (there's no GA4/Firebase project yet), so
every call is a safe no-op until a provider is registered later via
`registerAnalyticsProvider(...)` - zero call-site rewrites when that day comes.

A handful of representative, fully anonymous events are wired in as a starting set:
`app_open` (`App.tsx`), `shape_completed` (`ShapeChallengeScreen.tsx`),
`purchase_completed` (`ShopScreen.tsx`), and `mega_card_unlocked`
(`megaChallengeStore.ts`). Privacy is enforced inside `trackEvent` itself, not just
by caller discipline: event names are restricted to a fixed, typed list, and a
case-insensitive key denylist strips anything resembling a name, email, or player/
user/device ID from every event's params before it ever reaches a provider.
Analytics is automatically off during local development (`npm run dev`) unless a
developer explicitly flips `localStorage["cydi.analyticsDebug.v1"] = "1"`, in which
case events are logged to the console instead for testing. Every provider call is
wrapped in try/catch and never awaited, so a slow, broken, or blocked analytics
provider can never affect gameplay.

Separately, Cloudflare Web Analytics (`index.html`) now provides general site
metrics - visits, referrers, performance - independent of the code above. It only
loads on the real production hosts, and only when a real beacon token is supplied
at build time via the `VITE_CF_WEB_ANALYTICS_TOKEN` env var (see `.env.example`) -
never a hardcoded placeholder, and it fails silently if blocked or unset.

The Settings privacy policy (`SettingsScreen.tsx`) is updated to accurately
describe this: aggregate Cloudflare metrics plus a small set of anonymous in-game
events that never include a name, email address, player ID, or other directly
identifying information.

## 0.14.0 - 2026-07-10

Added a persistent, twinkling glitter effect to the Diamond Blue pen
(`DrawingCanvas.tsx` / `global.css`): tiny star-shaped sparkles pop in along
the stroke as the player draws with it, then settle into their own slow,
randomly-timed infinite shimmer instead of fading away, so a finished Diamond
Blue drawing stays glinting. Purely cosmetic - the sparkle layer sits above
the canvas with `pointer-events: none` and never touches stroke points or
scoring - and stays cheap on mobile via compositor-only opacity/transform
animation, a throttled spawn rate, and a concurrency cap; sparkles are only
cleared on Clear/Undo/switching shapes, and the effect respects
`prefers-reduced-motion`.

Tapping a locked ink color from the pen menu (🖊️) now deep-links straight into
the shop's Ink Colors section instead of dropping the player on the shop's
front page (`ShopScreen.tsx`, `routes.ts`, `GameMode.ts`, and every screen that
hosts the pen menu). The shop auto-scrolls to the specific color's card and
briefly flashes it with a highlight ring so it's obvious what they were sent
there for. No pricing or purchase logic changed - once bought, the color is
selectable from the pen menu as usual.

## 0.13.0 - 2026-07-10

Lowered the one-time Mega Challenge unlock cost from 20,000 to 10,000 coins
(`constants.ts`), making the feature reachable much sooner.

Reworked the shop's Mega Cards section for players who haven't unlocked the
Mega Challenge yet (`ShopScreen.tsx` / `global.css`). Instead of loading a lock
message into every card, there's now a single prominent "Open Mega Challenge
first" call-to-action below the album progress bar that takes the player
straight to the Shape Challenge screen where the feature is unlocked. The pack
cards stay visible but their price buttons read "🔒 1500/2000/3500/6000" and are
inert - tapping one shows a brief toast and never spends coins, pulls a card, or
opens a random pack. Once the Mega Challenge is unlocked the CTA disappears and
the packs return to normal.

## 0.12.0 - 2026-07-10

Added a cosmetic drawing-pen overlay (`DrawingCanvas.tsx` / `global.css`): a
small pen icon now appears next to the touch/cursor point while the player is
drawing, follows the pointer with a smooth trailing animation, and fades out
when they lift off. It's purely visual - `pointer-events: none`, driven by
writing `transform` straight to the DOM (no React re-render per move) plus a
short CSS transition, so it stays light on mobile and never touches the
points, accuracy, difficulty, or scoring. The nib is tinted to match the
selected pen ink color. Positioned just off the contact point (lifted higher
on touch devices) so it never hides where the player is drawing, and it
respects `prefers-reduced-motion`. Groundwork for future purchasable pen skins.

## 0.11.3 - 2026-07-10

Fixed the "double your reward" multiplication quiz (`DoubleCoinsOffer.tsx`)
sometimes rejecting keystrokes in its answer field on mobile/tablet devices,
especially Android tablets - `type="number"` inputs are known to be unreliable
on some of those keyboards. Switched to `type="text"` with `inputMode="numeric"`
and a digits-only filter on input, which keeps the numeric keypad but avoids
the native number-input bug.

## 0.11.2 - 2026-07-10

Mobile-only readability pass, two screens:

- Shape Challenge (`ShapeChallengeScreen.tsx` / `global.css`, `AppHeader.tsx`):
  fixed dark-on-dark text in the Mega Challenge entry card on narrow screens
  (title now solid white, subtitle/badge/progress bar all readable against
  the gradient), fixed the header icon row stranding a lone "Settings" icon
  on its own line by forcing a balanced wrap point, tightened top spacing so
  content starts higher, guaranteed the category grid stays 2 columns down
  to 320px, and raised contrast on category card progress text. All changes
  are scoped to `max-width: 768px` / `480px` media queries - desktop is
  unchanged.
- Mega Challenge Album (`MegaChallengeScreen.tsx` / `global.css`): removed
  the small difficulty fire-icon row under each card name, replaced the
  tiny "Play ▸" label with a clear "Start Challenge" pill button, and
  reworded/re-styled the played state as a matching outlined "Best score:
  X%" pill instead of plain muted text.

## 0.11.1 - 2026-07-10

Hotfix: existing players' saves (from before per-shape best-score
tracking shipped) have no `specialChallenge.bestScores` field, which
crashed Special Challenge with an uncaught error the moment a drawing
finished scoring, leaving the screen stuck on "Analyzing..." forever.
`getSpecialChallengeBestScore` / `recordSpecialChallengeScore` in
`specialChallengeStore.ts` now fall back to `{}` when the field is
missing, matching the normalization pattern already used for Mega
Challenge saves.

## 0.11.0 - 2026-07-10

Redesigned the Shop's Mega Cards section to feel more game-like and
rewarding: an intro line explaining the packs, a "Mega Album: X / 12
collected" progress bar, bigger card-framed pack icons with a clear
rarity ladder (plain Random, subtle Rare border, glowing gold Epic,
premium cyan-glow Legendary), a "X cards left" badge per pack, and a
clickable "Mega Cards" heading that jumps straight to the Mega Challenge
Album. No changes to purchase logic or pack prices.

- Special Challenge now rotates its featured shape daily instead of
  staying fixed on one shape: the target is deterministically picked
  from the Fantasy category by calendar date, so every player sees the
  same shape on a given day and it changes at local midnight. An intro
  card timer shows "New shape in HH:MM" until the next rotation.
- Special Challenge rewards now pay only the improvement over that
  shape's previous best score (tracked per shape) rather than the full
  tier reward on every replay, matching Shape Challenge's existing
  best-score economy.

## 0.10.0 - 2026-07-10

Reordered the Home screen so Shape Challenge leads and is visually
highlighted (thicker accent border, purple glow ring, slight scale-up),
with Daily Challenge right after it, then Create Challenge, My Challenges,
and Shop.

- Reworked several shape drawings for better geometric construction and
  detail: turtle, butterfly, horse, lollipop, hockey stick, crown, kite
  shield, gem, treasure chest, at-sign symbol, and bluetooth symbol.
- Swapped the Special Challenge's featured shape from the dragon to the
  castle.

## 0.9.0 - 2026-07-10

Added an onboarding tutorial for new players: a short 5-step intro modal
(`OnboardingTutorialOverlay`) that walks through the main game modes -
welcome/scoring, Shape Challenge, Daily Challenge, Create & Share, and
Coins & Shop.

- Shows automatically on a player's first visit only; a new
  `onboardingTutorialShown` save flag plus a `completedRounds === 0` guard
  keeps it from popping up for existing players whose saves predate the
  flag.
- Each step has a big icon, a colored title matching the home-card accent
  of that game mode, a short description, progress dots, and Next / Start
  Playing navigation; Back (hidden on the first step) returns to the
  previous step and Skip dismisses at any time. Fully keyboard-accessible
  (focus trap, Escape closes).
- The How to Play screen (`InstructionsScreen`) gained a "Start Tutorial"
  button that replays the tutorial on demand.

## 0.8.0 - 2026-07-10

Added the Mega Challenge: a long-term collectible card album of 12 premium
drawings (Rare / Epic / Legendary), reached from a festive entry card on the
Shape Challenge screen.

- The feature itself starts locked and opens permanently for a one-time
  20,000-coin payment (celebratory unlock animation, first card granted
  free). Without enough coins a short "Need 20,000 coins..." message shows.
- New album screen (`MegaChallengeScreen`): hero card with collection
  progress, responsive card grid (2/3/4 columns), open cards with rarity
  frames and best scores, locked cards as mystery cards with a patterned
  card back and an unlock button.
- Cards unlock either through existing achievements (one condition = one
  achievement, no duplicates) or with coins - specific unlocks from the
  album (2,500/4,500/8,000 by rarity) and random card packs in the Shop
  (1,500-6,000).
- Each card is playable as a drawing challenge with the standard
  preview/draw/score flow; first passing score pays a one-time rarity-based
  completion reward (300/600/1,200), and 90+ marks the card ✨ Perfect.
- Completing the whole album awards the permanent "Challenge Champion"
  title: a celebration screen with sharing, plus a 👑 badge in the app
  header on every screen.
- The 12 drawings live in a separate `megaShapeLibrary.ts` (kept out of
  `SHAPE_LIBRARY` so journey/achievement counts stay honest), built
  geometrically in a structural style: crown, trophy, sword, rocket, robot,
  castle, wizard hat, treasure chest, pirate galleon, legendary key,
  phoenix, thunder hammer.
- The Settings "Unlock Everything" test toggle now also force-opens the
  Mega Challenge and all its cards, without writing to real progress - and
  never fakes the permanent Champion title.

## 0.7.1 - 2026-07-05

- Fixed "Next Shape": clicking it from the result screen previously reused
  the same component instance with stale phase/result state (only the ghost
  target visually updated). Added `key={selectedIndex}` so each shape gets a
  fresh mount, correctly landing on a new "Study the shape" preview.
- Added encouragement on a missed attempt (score below 70): a gentle,
  synthesized two-note dip sound (`playEncourageSound`, still no external
  audio) plus a random supportive message ("Not bad!", "Try again!", "So
  close!", etc.), shown the same way the celebration banner is for a pass.

## 0.7.0 - 2026-07-05

Added sound and celebration on passing a Shape Challenge level.

- `src/engine/soundEngine.ts`: a short success chime synthesized entirely
  in-browser via the Web Audio API (oscillator tones) - no audio files,
  samples, or third-party sound effects, so there's no copyright risk.
- Passing a level (score 70+) now plays that chime and shows a random
  encouraging banner ("Great job!", "Well done!", etc.).
- Added a 🔊/🔇 `SoundToggleButton`, persisted in `localStorage`, shown in
  the shared `AppHeader` (covering every screen that uses it) plus the two
  result screens that render without a header.

## 0.6.1 - 2026-07-05

Replaying an already-passed shape and succeeding now shows "Next Shape"
straight away (jumping to the shape right after it, already unlocked),
instead of forcing a trip back to the map first.

## 0.6.0 - 2026-07-05

Added two ways to see the target shape more clearly in Shape Challenge.

- Result screen now shows `ShapeOverlayCanvas`: the target shape (gray,
  semi-transparent) overlaid with the player's own attempt (blue), with a
  legend, so it's visually clear what to improve.
- Added a "Show Guide" toggle during the drawing phase itself, letting the
  player keep the target visible (same semi-transparent ghost style) while
  actively drawing, to trace and build skill — the canvas stays fully
  interactive while the guide is shown.

## 0.5.1 - 2026-07-05

Clicking "Try Again" after a failed (or passed) Shape Challenge attempt now
returns to the "Study the shape" preview phase first, instead of jumping
straight back to a blank drawing canvas — giving the player another look
at the target shape before their next try.

## 0.5.0 - 2026-07-05

Made the scoring engine noticeably stricter about actual shape correctness.

- `comparePointArrays` (`src/engine/comparePaths.ts`) now uses root-mean-square
  point-to-point distance instead of a plain mean, which punishes localized
  mismatches (e.g. a star's concave points not matching a circle's constant
  radius) far more than an averaged distance did.
- Rebalanced `SCORE_WEIGHTS` so `shapeMatch` — the only sub-score that
  actually measures shape correctness — dominates the total (0.65 → 0.85),
  since `coverage`/`smoothness`/`scale` were propping up scores for clearly
  wrong shapes that happened to be a similar size.
- Verified: a circle drawn against a star target dropped from 85 to 53; a
  random scribble dropped further to 5; identical and reverse/rotated
  redraws are unaffected (still 100).

## 0.4.1 - 2026-07-05

Locked shapes on the Shape Challenge map no longer reveal any preview of
the shape itself — only the 🔒 icon and name are shown, removing the
dimmed outline that previously hinted at what was coming.

## 0.4.0 - 2026-07-05

Added a Shape Challenge level map.

- Entering Shape Challenge now opens a map screen showing all 52 shapes at
  once (`ShapeChallengeScreen`'s new `ShapeMap` view), each rendered with a
  small SVG outline preview (`src/components/ShapePreviewIcon.tsx`).
- Shapes are strictly sequential and never repeat: a shape is locked (dimmed
  preview, 🔒 icon, not clickable) until every shape before it has been
  passed (score 70+); completed shapes stay unlocked, show their best score
  as a badge, and can be replayed any time to improve it.
- Removed the old auto-advancing/looping progression — progress is now
  driven entirely by `progress.levelIndex` as a strict unlock frontier, with
  no wraparound back to the first shape.

## 0.3.0 - 2026-07-05

Expanded Shape Challenge with more levels and a progression gate.

- Grew the shape library from 8 to 52 shapes (`src/engine/shapeLibrary.ts`),
  ordered by increasing difficulty: circle, regular polygons (3-12 sides),
  point-stars (4-10 points), heart/arrow/crescent moon, multi-petal flowers
  (3-10 petals), zigzags, waves, growing spirals, many-toothed gears, and
  finally self-intersecting Lissajous curves.
- Added a pass threshold (`SHAPE_CHALLENGE_PASS_SCORE = 70`): scoring below
  70 disables "Next Shape" and shows an inline message; the required score
  is now also shown up front, next to the current level's best score.

## 0.2.0 - 2026-07-05

Added Shape Challenge mode: a system-generated progression loop.

- Added `src/engine/shapeLibrary.ts`: eight original, parametrically generated
  target shapes (circle, square, triangle, star, heart, spiral, infinity,
  arrow) ordered by increasing difficulty, reused by the existing scoring
  engine with no changes to it.
- Added `src/services/shapeChallengeProgress.ts` for `localStorage`-backed
  progression state (current level, per-shape best score) under the
  `cydi.shapeChallenge.progress.v1` key, with the same defensive-parsing
  approach as challenge storage.
- Added `ShapeChallengeScreen`: study/draw/analyze/result loop against the
  current level's generated shape, with Try Again (retry) and Next Shape
  (advance, looping back to the start after the last shape) actions.
- Added a fourth Home screen card, "Shape Challenge", alongside the existing
  three (the "Daily Challenge — Coming Soon" placeholder is unchanged).

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
