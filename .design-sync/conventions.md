# Building with CYDI

CYDI is a mobile-first drawing game. These components are its real shipped UI —
the same code that runs in the app and in the Play Store build. Designs made
from them should read as CYDI screens: a tinted page, white rounded cards
stacked in a narrow column, one purple primary action per screen.

## Setup — there is no provider

There is no theme provider, context, or root wrapper to mount. Import a
component and render it; the styling comes entirely from the stylesheet.

**Dark mode** is an attribute on the root element, not a prop or a context:

```html
<html data-theme="dark">   <!-- omit the attribute for light -->
```

Every color token is redefined under `:root[data-theme="dark"]`, so a design
built from tokens flips correctly for free. Never hard-code a hex that a token
already covers — it will be wrong in one of the two themes.

**Some components own their state.** `CoinIndicator`, `SoundToggleButton` and
`ChampionBadge` read the player's saved progress rather than props, so they take
few or no inputs and render their real values. `ChampionBadge` renders nothing
at all until the player has earned the title — that is correct behavior, not a
broken import.

## The styling idiom: global classes + CSS custom properties

CYDI uses **plain global class names** (no CSS modules, no utility framework, no
style props). Components carry their own classes internally; for your own layout
glue, use the tokens directly and reuse these class names where they fit.

**Layout**

| Class | What it is |
|---|---|
| `screen` | Full-height page column, centered, with the standard page padding. Every screen is this. |
| `card` | White rounded surface, `max-width: 420px`. The default container for content. |
| `empty-state` | Centered message + optional action, for "nothing here yet". |
| `status-text` | Muted secondary line. |

**Buttons** — `btn` plus one variant: `btn-primary` (filled purple),
`btn-secondary` (grey fill), `btn-danger` (red text, no fill). Add `btn-compact`
to shrink one for an inline row. In practice use the `Button` component, which
applies these and also plays the app's click sound; it forwards `className`.

**Tokens** — the whole design language, all theme-aware:

| Family | Names |
|---|---|
| Core color | `--color-primary` `--color-primary-dark` `--color-primary-fill` `--color-accent` `--color-success` `--color-danger` |
| Surface | `--color-page-bg` `--color-bg` `--color-card` `--color-border` `--color-control-border` |
| Text | `--color-text` `--color-text-muted` `--color-primary-text` `--color-on-accent` `--color-on-success` `--color-on-muted` |
| Category accents | `--accent-blue` `--accent-purple` `--accent-pink` `--accent-green` `--accent-orange` (each with a darker `-text` variant, plus `--accent-gold-text`) |
| Radius | `--radius-sm` (8px) `--radius-md` (14px) `--radius-lg` (20px) |
| Space | `--space-1` (4px) through `--space-6` (32px) |

Type is a system stack (`-apple-system, "Segoe UI", Roboto, …`) — there is no
brand webfont, so do not load one.

## Where the truth is

Read `_ds/<folder>/styles.css` and the file it imports before styling anything —
it is CYDI's complete stylesheet, and it defines every class and token above.
Per-component props and usage notes are in each `<Name>.prompt.md`.

## An idiomatic screen

```jsx
<div className="screen">
  <AppHeader title="Daily Challenge" subtitle="One shape a day" onBack={goBack} />

  <ScoreCard score={score} isNewBest showPercentSign />

  <div style={{ display: "grid", gap: "var(--space-3)", width: "100%", maxWidth: 420 }}>
    <DailyLeaderboardTable entries={entries} />
    <Button variant="primary" onClick={playAgain}>Play again</Button>
    <Button variant="secondary" onClick={goHome}>Back to home</Button>
  </div>
</div>
```

Library components for the controls; tokens and the class names above for the
layout between them.
