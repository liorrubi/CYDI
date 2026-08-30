/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The approved 3a composition for the Multiplayer entry, on the web.
 *
 * PRESENTATION ONLY - this is the architecture the brief asked for: a new
 * web-only view sitting on top of the EXISTING Multiplayer actions and state.
 * It owns no session, opens no socket, creates no room and validates no code.
 * The two things it can do are call back into PlayTogetherScreen, which still
 * owns every bit of that logic:
 *
 *   onCreateRoom()      -> the existing create-room view
 *   onJoinWithCode(code) -> the existing join view, with the field prefilled
 *
 * So the real create/join flows - nickname, round count, difficulty, the code
 * validation, the lobby, QR/share and Start Game - are untouched and still the
 * only path into a room. Android never renders this: PlayTogetherScreen only
 * reaches for it on the web.
 *
 * VISUAL RULE (the current approved one, not the earlier screenshot): a room is
 * ONE shared target plus RANKED RESULTS with a clear winner. CYDI never shows
 * every player's drawing stacked on one canvas, because that is not how the
 * game presents a round - people draw on their own devices.
 *
 * Every stated fact comes from siteContent/publicFacts, never from the mockup.
 */
import { useState, type FormEvent } from "react";
import SiteShape from "./SiteShape";
import { RoomResults } from "./ModePreview";
import { resolveSiteShapesOrFirst } from "./siteShapes";
import { MP_ROOM_CODE_LENGTH } from "../content/publicFacts";
import {
  MULTIPLAYER_FACTS,
  MULTIPLAYER_INTRO,
  MULTIPLAYER_ROUND_STEPS,
  PLAYER_RANGE,
  ROUND_OPTIONS_TEXT,
} from "../content/siteContent";
import "../styles/site.css";

/** The loop, in four words - the thing a visitor should grasp before reading. */
const LOOP_RAIL = ["One shape", "One countdown", "Everyone draws", "Reveal together"];

type MultiplayerEntryProps = {
  /** Opens the existing Create Game view. */
  onCreateRoom: () => void;
  /** Opens the existing Join Game view, prefilled with whatever was typed. */
  onJoinWithCode: (code: string) => void;
};

export default function MultiplayerEntry({ onCreateRoom, onJoinWithCode }: MultiplayerEntryProps) {
  // Local to the field only. The real code lives in PlayTogetherScreen, which
  // is also what validates it - this just carries what was typed across.
  const [code, setCode] = useState("");

  const shape = resolveSiteShapesOrFirst(["univ-compass"], 1)[0]?.shape;
  const clock = MULTIPLAYER_FACTS.find((fact) => fact.label === "Round clock")?.value ?? "";

  function submit(event: FormEvent) {
    event.preventDefault();
    onJoinWithCode(code.trim().toUpperCase());
  }

  return (
    <div className="site-mpentry">
      <section className="site-mpentry-hero">
        <div className="site-mpentry-copy">
          <span className="site-pill site-pill-multiplayer">
            Live rooms · {PLAYER_RANGE} players
          </span>

          <h2 className="site-h2">
            One shape. One countdown.
            <br />
            <span className="site-mpentry-accent">Everyone draws at once.</span>
          </h2>

          {/* The loop, stated before any control asks for anything. */}
          <ol className="site-mpentry-rail" aria-label="How a round runs">
            {LOOP_RAIL.map((step, i) => (
              <li key={step}>
                <span className="site-mpentry-rail-step">{step}</span>
                {i < LOOP_RAIL.length - 1 && (
                  <span className="site-mpentry-rail-sep" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>

          <p className="site-lede">
            {MULTIPLAYER_INTRO} Rooms run {ROUND_OPTIONS_TEXT} rounds.
          </p>

          {/* Join, in the hero. The field is a convenience: submitting hands the
              code to the existing join view, which does the real validating. */}
          <form className="site-mpentry-join" onSubmit={submit}>
            <label className="site-mpentry-join-label" htmlFor="site-mp-code">
              Enter the {MP_ROOM_CODE_LENGTH}-character room code
            </label>
            <div className="site-mpentry-join-row">
              <input
                id="site-mp-code"
                className="site-mpentry-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                maxLength={MP_ROOM_CODE_LENGTH}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="ABC123"
                aria-describedby="site-mp-code-hint"
              />
              <button type="submit" className="site-cta site-cta-large">
                Join room
              </button>
            </div>
            <p className="site-meta" id="site-mp-code-hint">
              No code yet?{" "}
              <button type="button" className="site-textlink site-linkbutton" onClick={onCreateRoom}>
                Create a room
              </button>{" "}
              — {PLAYER_RANGE} players, {ROUND_OPTIONS_TEXT} rounds. No app, no account.
            </p>
          </form>
        </div>

        {/* The main visual: the one shape a room is given, and the ranking it
            produced. Never several drawings on one canvas. */}
        <div className="site-paper site-mpentry-visual">
          <div className="site-paper-head">
            <span className="site-paper-label">Room results</span>
            <span className="site-paper-tag site-paper-tag-room">Illustrative</span>
          </div>
          {shape && (
            <div className="site-mpentry-target">
              <SiteShape shape={shape} size={120} strokeWidth={3} variant="site-modeart-targetshape" />
              <span className="site-modeart-roomart-label">Everyone drew this</span>
            </div>
          )}
          {shape && <RoomResults shape={shape} />}
          <p className="site-paper-caption">
            Scores are what CYDI&apos;s own scorer gives four different drawings of that shape. Everyone draws on their
            own device; the room sees the ranking together.
          </p>
        </div>
      </section>

      {/* How one round works - the compact strip, from canonical timings. */}
      <section className="site-mpentry-steps" aria-labelledby="site-mpentry-steps-heading">
        <div className="site-mpentry-steps-head">
          <span className="site-kicker" id="site-mpentry-steps-heading">
            How one round works
          </span>
          {clock && <span className="site-mpentry-clock">{clock}</span>}
        </div>
        <ol className="site-mpentry-stepgrid">
          {MULTIPLAYER_ROUND_STEPS.map((step, i) => (
            <li className="site-mpentry-step" key={step.title}>
              <span className="site-mpentry-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <strong className="site-mpentry-step-title">{step.title}</strong>
              <span className="site-mpentry-step-body">{step.body}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* The primary host action, given its own weight at the end. */}
      <div className="site-mpentry-create">
        <button type="button" className="site-cta site-cta-large" onClick={onCreateRoom}>
          Create a room
        </button>
        <span className="site-meta">You host, share the code, and start when everyone is in.</span>
      </div>
    </div>
  );
}
