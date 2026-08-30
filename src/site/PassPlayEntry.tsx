/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The approved 3a composition for the 2 Players entry, on the web.
 *
 * This is 3a's "How 2 Players works" artboard turned into the real entry
 * screen: the mechanic explained as the five things that actually happen, the
 * head-to-head result shown beside it, and the setup controls folded into the
 * same composition instead of sitting under it as a full-width form.
 *
 * PRESENTATION ONLY, and fully CONTROLLED. It holds no state of its own - every
 * value and every handler is a prop, owned by PassPlayScreen, which still does
 * all the work: name cleaning, duplicate-name detection, the round and
 * difficulty options, validation and starting the game. Nothing about pass-play
 * state, round logic or scoring is duplicated or re-implemented here.
 *
 * Android never renders this: PassPlayScreen only reaches for it on the web.
 *
 * The illustrative result is the shared TwoPlayerAttempts - two genuinely
 * different drawings of one target, scored by the game's own scorer, with the
 * winner derived from those scores.
 */
import { TwoPlayerAttempts } from "./ModePreview";
import { runtimeCatalogCounts, resolveSiteShapesOrFirst } from "./siteShapes";
import { passPlaySteps } from "../content/siteContent";
import { MP_DRAWING_SECONDS, MP_SHOW_SHAPE_SECONDS } from "../content/publicFacts";
import "../styles/site.css";

type PassPlayEntryProps = {
  /** One name per seat, in seat order. */
  names: string[];
  onNameChange: (seat: number, value: string) => void;
  maxNameLength: number;

  rounds: number;
  roundOptions: readonly number[];
  onRounds: (rounds: number) => void;

  difficulty: string;
  difficultyOptions: readonly string[];
  difficultyLabel: (option: string) => string;
  difficultyHint: string;
  onDifficulty: (option: string) => void;

  /** Validation message from the screen, already worded by it. */
  formError: string | null;
  onStart: () => void;
};

const NAME_PLACEHOLDERS = ["e.g. Maya", "e.g. Tom"];

export default function PassPlayEntry({
  names,
  onNameChange,
  maxNameLength,
  rounds,
  roundOptions,
  onRounds,
  difficulty,
  difficultyOptions,
  difficultyLabel,
  difficultyHint,
  onDifficulty,
  formError,
  onStart,
}: PassPlayEntryProps) {
  const steps = passPlaySteps(runtimeCatalogCounts());
  const shape = resolveSiteShapesOrFirst(["univ-compass"], 1)[0]?.shape;

  return (
    <div className="site-ppentry">
      <section className="site-ppentry-hero">
        <div className="site-ppentry-copy">
          <span className="site-kicker">One device · head to head</span>
          <h2 className="site-h2">Two players, one phone, one shape</h2>
          <p className="site-meta">
            {MP_SHOW_SHAPE_SECONDS}s study · {MP_DRAWING_SECONDS}s draw · no connection needed
          </p>

          {/* What actually happens, in order. */}
          <ol className="site-ppentry-steps">
            {steps.map((step, i) => (
              <li className="site-ppentry-step" key={step.title}>
                <span className="site-ppentry-step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <strong className="site-ppentry-step-title">{step.title}</strong>
                  <span className="site-ppentry-step-body">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* The head-to-head result: two different drawings of one target, with
            the scorer's own numbers and the winner derived from them. */}
        {shape && (
          <div className="site-paper site-ppentry-result">
            <div className="site-paper-head">
              <span className="site-paper-label">Round result · {shape.name}</span>
              <span className="site-paper-tag">Illustrative</span>
            </div>
            <span className="site-modeart site-modeart-two">
              <TwoPlayerAttempts shape={shape} />
            </span>
            <p className="site-paper-caption">
              Illustrative scores from CYDI&apos;s own scorer. Who draws first alternates each round.
            </p>
          </div>
        )}
      </section>

      {/* The real setup, inside the composition rather than under it. */}
      <section className="site-ppentry-setup" aria-labelledby="site-ppentry-setup-heading">
        <span className="site-kicker" id="site-ppentry-setup-heading">
          Set up the game
        </span>

        <div className="site-ppentry-grid">
          <fieldset className="site-ppentry-field">
            <legend className="site-ppentry-legend">Players</legend>
            <div className="site-ppentry-names">
              {names.map((name, seat) => (
                <label className="site-ppentry-name" key={seat}>
                  <span className="site-ppentry-name-label">Player {seat + 1}</span>
                  <input
                    className="mp-input"
                    value={name}
                    onChange={(event) => onNameChange(seat, event.target.value)}
                    maxLength={maxNameLength}
                    placeholder={NAME_PLACEHOLDERS[seat] ?? `Player ${seat + 1}`}
                    autoComplete="off"
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="site-ppentry-field">
            <legend className="site-ppentry-legend">Rounds</legend>
            <div className="mp-chip-row">
              {roundOptions.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={count === rounds ? "mp-chip mp-chip-active" : "mp-chip"}
                  aria-pressed={count === rounds}
                  onClick={() => onRounds(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="site-ppentry-field">
            <legend className="site-ppentry-legend">Difficulty</legend>
            <div className="mp-chip-row">
              {difficultyOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === difficulty ? "mp-chip mp-chip-active" : "mp-chip"}
                  aria-pressed={option === difficulty}
                  onClick={() => onDifficulty(option)}
                >
                  {difficultyLabel(option)}
                </button>
              ))}
            </div>
            <p className="site-meta">{difficultyHint}</p>
          </fieldset>
        </div>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <button type="button" className="site-cta site-cta-large" onClick={onStart}>
          Start Game
        </button>
      </section>
    </div>
  );
}
