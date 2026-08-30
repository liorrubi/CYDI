/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Art direction 3a: the public home at "/". Marketing surface only.
 *
 * It is NOT the game's home screen. HomeScreen.tsx is untouched and stays the
 * secondary hub for Daily Challenge, Create, My Challenges and the Shop, which
 * this page reaches through "More challenges" (App.tsx's "/play" screen).
 * Android never renders this file.
 *
 * THE HIERARCHY THIS PAGE IMPLEMENTS - "/play" is never a step on the way into
 * Classic. Every primary way to start playing lands on /play/classic directly:
 *
 *   Classic (nav) / Play now / Play in browser / the Classic mode card
 *                                          -> onPlayClassic  -> /play/classic
 *   2 Players (nav, mode card)             -> /2-player-drawing-game-one-phone
 *   Multiplayer (nav, mode card, Join)     -> /multiplayer-drawing-game
 *   More challenges                        -> onOpenGameMenu -> /play
 *   Daily teaser                           -> the existing Daily flow
 *
 * "/play" is deliberately never labelled "Play" here: it is "More challenges"
 * from this page and "Game menu" from inside the game, so Home, Classic and the
 * hub stay three distinct ideas rather than three names for one.
 *
 * Every product number below comes from src/content/siteContent.ts, which
 * derives them from publicFacts - the mockups' "276", "12", "2-8",
 * "5, 10 or 15", "3s" and "20s" are all bindings, not literals.
 */
import { Fragment, useState } from "react";
import SiteShell from "./SiteShell";
import RotatingHeroShape, { useHeroShapes } from "./RotatingHeroShape";
import type { HeroPhase } from "./HeroDrawing";
import { runtimeCatalogCounts } from "./siteShapes";
import ModePreview from "./ModePreview";
import type { ShapeDefinition } from "../content/contentRepository";
import { getCoins } from "../services/coinsStore";
import { getCurrentStreak } from "../services/dailyStreakStore";
import { DAILY_PRIZE_COINS, MP_ROOM_CODE_LENGTH } from "../content/publicFacts";
import {
  MULTIPLAYER_INTRO,
  MULTIPLAYER_ROUND_STEPS,
  passPlaySteps,
  PLAYER_RANGE,
  ROUND_OPTIONS_TEXT,
  SITE_MODES,
  SITE_NAV,
  type SiteMode,
} from "../content/siteContent";

type SiteHomeProps = {
  /**
   * The primary action: straight into Classic gameplay. Deliberately NOT the
   * game's menu screen - coming off this page into the old menu is the jarring
   * hand-off the redesign is meant to remove.
   */
  onPlayClassic: () => void;
  /**
   * The secondary hub: the existing game HomeScreen, which is still the one
   * place Daily Challenge, Create Challenge, My Challenges and the Shop live.
   * Nothing about that screen changes; it just stops being the first thing a
   * visitor meets, and it is NOT on the path into Classic - it is surfaced only
   * as "More challenges". (That screen now renders the 5b Game Hub on the web,
   * via src/site/GameHub.tsx; this contract was unaffected by that landing.)
   */
  onOpenGameMenu: () => void;
  /** Opens the existing Daily Challenge flow from the teaser. */
  onDailyChallenge: () => void;
};

/** An illustrative room code, shown as one box per character of the real length. */
const SAMPLE_ROOM_CODE = "K7R2Q9";

/** Each mode's canonical URL, taken from the nav so the two cannot diverge. */
const MODE_HREF = Object.fromEntries(SITE_NAV.map((item) => [item.mode, item.href])) as Record<
  SiteMode["id"],
  string
>;

export default function SiteHome({ onPlayClassic, onOpenGameMenu, onDailyChallenge }: SiteHomeProps) {
  // The real balance, never a mocked one - and hidden entirely for a visitor who
  // has not earned any yet, so a first-time viewer is not shown a zero.
  const [coins] = useState(() => getCoins());
  // A real local value, read once - no network call on a marketing page.
  const [streak] = useState(() => getCurrentStreak());
  // Which step of the loop the hero is on, so the card's rule row below it can
  // mark the same one. The row is part of the approved layout, not an addition.
  const [heroPhase, setHeroPhase] = useState<HeroPhase>("see");
  // Counts and lists both from the active catalog - never a build-time number
  // sitting next to a runtime list. See runtimeCatalogCounts().
  const counts = runtimeCatalogCounts();
  const passPlay = passPlaySteps(counts);


  // One real catalog shape drawn by all three mode cards, so they are comparing
  // like with like.
  const artShapes = useHeroShapes(4);
  const artShape: ShapeDefinition | undefined =
    artShapes.find((entry) => entry.shape.id === "univ-compass")?.shape ?? artShapes[0]?.shape;


  return (
    <SiteShell
      onPlay={onPlayClassic}
      footerMeta={`${counts.shapes} shapes · ${counts.categories} categories`}
      navExtra={
        <>
          {coins > 0 && (
            <span className="site-coin">
              <span className="site-coin-dot" aria-hidden="true" />
              {coins.toLocaleString()}
            </span>
          )}
          <button type="button" className="site-cta site-cta-small" onClick={onPlayClassic}>
            Play now
          </button>
        </>
      }
    >
      {/* ------------------------------------------------------------ hero -- */}
      <section className="site-hero">
        <div className="site-hero-grid" aria-hidden="true" />
        <div className="site-hero-bloom" aria-hidden="true" />
        <div className="site-width">
          <div className="site-hero-inner">
            <div className="site-hero-copy">
              <span className="site-pill">A drawing game of memory</span>
              <h1 className="site-h1">
                See it.
                <br />
                Remember it.
                <br />
                Draw it.
                <br />
                <span className="site-h1-accent">Get your score.</span>
              </h1>
              {/*
                * No duration stated. The preview is FIRST_ROUND_PREVIEW_SECONDS
                * on a player's very first round and PREVIEW_SECONDS on every one
                * after, so a single number here would be wrong for almost every
                * round played. 2 Players and Multiplayer DO have one fixed clock
                * each, and still state it.
                */}
              <p className="site-lede">
                One of {counts.shapes} shapes appears. Then it is gone, and you draw it from memory. CYDI scores your
                accuracy to the percent.
              </p>
              <div className="site-hero-actions">
                <button type="button" className="site-cta site-cta-large" onClick={onPlayClassic}>
                  Play in browser
                </button>
                <a className="site-cta-ghost" href={MODE_HREF.multiplayer}>
                  Join a room
                </a>
              </div>
              {/* Secondary by design: a quiet entry, never competing with the
                  three modes or with Play in browser. */}
              <button type="button" className="site-more" onClick={onOpenGameMenu}>
                <span className="site-more-label">
                  More challenges <span aria-hidden="true">→</span>
                </span>
                <span className="site-more-sub">Daily Challenge, create your own, saved challenges &amp; Shop</span>
              </button>
              <div className="site-metarow">
                <span className="site-meta">Plays in the browser</span>
                <span className="site-metarow-dot" aria-hidden="true" />
                <span className="site-meta">No account</span>
                <span className="site-metarow-dot" aria-hidden="true" />
                <span className="site-meta">
                  Live rooms · {PLAYER_RANGE} players
                </span>
              </div>
            </div>

            <div className="site-paper">
              <div className="site-paper-head">
                <span className="site-paper-label">Round in play</span>
                <span className="site-paper-tag">From memory</span>
              </div>
              <RotatingHeroShape onPhaseChange={setHeroPhase} />
              <div className="site-paper-rule">
                {(["see", "remember", "draw", "score"] as HeroPhase[]).map((step, i) => (
                  <Fragment key={step}>
                    {i > 0 && <span aria-hidden="true">→</span>}
                    <span className={step === heroPhase ? "site-paper-rule-active" : undefined}>
                      {step === "see" ? "See" : step === "remember" ? "Remember" : step === "draw" ? "Draw" : "Score"}
                    </span>
                  </Fragment>
                ))}
                <span className="site-paper-rule-count">
                  {counts.shapes} shapes across {counts.categories} categories
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- three ways to play -- */}
      <section className="site-band site-band-alt" aria-labelledby="site-modes-heading">
        <div className="site-width">
          <div className="site-band-head">
            <div>
              <span className="site-kicker">Same shape, different company</span>
              <h2 className="site-h2" id="site-modes-heading">
                Three ways to play
              </h2>
            </div>
          </div>
          <div className="site-modes">
            {SITE_MODES.map((mode) => {
              const target = MODE_HREF[mode.id];
              // The whole card is the link, so any part of it is clickable and
              // it is reachable and operable from the keyboard for free.
              // Classic is a route this app already owns, so a plain click is
              // handled in-app; the other two are separate documents.
              return (
                <a
                  key={mode.id}
                  className={`site-mode site-mode-${mode.id}`}
                  href={target}
                  onClick={
                    mode.id === "classic"
                      ? (event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                          event.preventDefault();
                          onPlayClassic();
                        }
                      : undefined
                  }
                >
                  <span className="site-mode-art" aria-hidden="true">
                    {artShape && <ModePreview mode={mode.id} shape={artShape} />}
                  </span>
                  <span className="site-mode-title">
                    <span className="site-mode-name">{mode.name}</span>
                    <span className="site-mode-kicker">{mode.kicker}</span>
                  </span>
                  <span className="site-body">{mode.description}</span>
                  <span className="site-mode-meta">{mode.meta}</span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------- how 2 players ------ */}
      <section className="site-band" aria-labelledby="site-passplay-heading">
        <div className="site-width">
          <div className="site-band-head">
            <div>
              <span className="site-kicker">One device · head to head</span>
              <h2 className="site-h2" id="site-passplay-heading">
                Two players, one phone, one shape
              </h2>
            </div>
            <span className="site-meta">No connection needed</span>
          </div>
          <ol className="site-steps">
            {passPlay.map((step, index) => (
              <li className="site-step" key={step.title}>
                <span className="site-step-num" aria-hidden="true">
                  {index + 1}
                </span>
                <span>
                  <strong className="site-step-title">{step.title}</strong>
                  <span className="site-step-body">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="site-band-cta">
            <a className="site-cta" href={MODE_HREF.passPlay}>
              Play 2 Players
            </a>
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- multiplayer ------ */}
      <section className="site-band site-band-alt" aria-labelledby="site-multiplayer-heading">
        <div className="site-width">
          <div className="site-hero-inner">
            <div className="site-hero-copy">
              <span className="site-pill site-pill-multiplayer">
                Live rooms · {PLAYER_RANGE} players
              </span>
              <h2 className="site-h2" id="site-multiplayer-heading">
                One shape. One countdown. Everyone draws at once.
              </h2>
              <p className="site-lede">{MULTIPLAYER_INTRO} Rooms run {ROUND_OPTIONS_TEXT} rounds.</p>
              <div>
                <span className="site-kicker">Enter the {MP_ROOM_CODE_LENGTH}-character room code</span>
                <div className="site-codeboxes" aria-hidden="true">
                  {Array.from({ length: MP_ROOM_CODE_LENGTH }, (_, i) => (
                    <span
                      className={i === MP_ROOM_CODE_LENGTH - 1 ? "site-codebox site-codebox-next" : "site-codebox"}
                      key={i}
                    >
                      {SAMPLE_ROOM_CODE[i] ?? ""}
                    </span>
                  ))}
                </div>
              </div>
              <div className="site-hero-actions">
                <a className="site-cta site-cta-large" href={MODE_HREF.multiplayer}>
                  Join room
                </a>
              </div>
              <p className="site-meta">
                No code yet?{" "}
                <a className="site-textlink" href={MODE_HREF.multiplayer}>
                  Create a room
                </a>{" "}
                — {PLAYER_RANGE} players, {ROUND_OPTIONS_TEXT} rounds.
              </p>
            </div>

            <div className="site-paper">
              <div className="site-paper-head">
                <span className="site-paper-label">How one round works</span>
              </div>
              <ol className="site-roundsteps">
                {MULTIPLAYER_ROUND_STEPS.map((step, index) => (
                  <li key={step.title}>
                    <strong>
                      {index + 1} · {step.title}
                    </strong>
                    <span>{step.body}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>
      {/* ----------------------------------------------- daily teaser ------ */}
      {/*
        * Secondary on purpose: a single slim card AFTER the three modes, not a
        * feature grid. It reads one real local value - the player's current
        * streak - and otherwise just opens the existing Daily Challenge flow.
        * No daily logic, no network call, nothing duplicated.
        */}
      <section className="site-band" aria-labelledby="site-daily-heading">
        <div className="site-width">
          <button type="button" className="site-daily" onClick={onDailyChallenge}>
            <span className="site-daily-text">
              <span className="site-kicker" id="site-daily-heading">
                Every day
              </span>
              <strong className="site-daily-title">Daily Challenge</strong>
              <span className="site-body">
                One shape for everyone, once a day. Top of the leaderboard takes{" "}
                {DAILY_PRIZE_COINS[0].toLocaleString()} coins.
              </span>
            </span>
            <span className="site-daily-side">
              {streak > 0 && (
                <span className="site-daily-streak">
                  {streak}-day streak
                </span>
              )}
              <span className="site-daily-go" aria-hidden="true">
                Play today&apos;s →
              </span>
            </span>
          </button>
        </div>
      </section>
    </SiteShell>
  );
}
