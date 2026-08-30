/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The canonical-source rule for the redesigned public site, enforced.
 *
 * publicFacts.test.ts already proves publicFacts matches the game. This file
 * proves the site copy built on top of it never restates a product fact by
 * hand: the numbers the 3a/4a mockups print as literals ("276", "12", "2-8",
 * "5, 10 or 15", "six-character", "3s", "20s") must move when the game moves.
 *
 * It works by CHANGING NOTHING and asserting relationships - a literal typed
 * into siteContent.ts would satisfy today's value and fail the moment the real
 * constant changed, which is exactly the drift this guards against. So the
 * assertions compare against the imported constants, never against a number.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CATEGORY_COUNT,
  MP_DRAWING_SECONDS,
  MP_MAX_PLAYERS,
  MP_MIN_PLAYERS,
  MP_ROOM_CODE_LENGTH,
  MP_ROUND_OPTIONS,
  SCORE_WEIGHT_PERCENTS,
  SHAPE_COUNT,
  MP_SHOW_SHAPE_SECONDS,
} from "./publicFacts";
import {
  formatOptionList,
  HEAVIEST_CRITERION,
  MULTIPLAYER_FACTS,
  MULTIPLAYER_INTRO,
  MULTIPLAYER_ROUND_STEPS,
  passPlaySteps,
  PLAYER_RANGE,
  ROOM_CODE_LENGTH_WORD,
  ROUND_OPTIONS_TEXT,
  SCORING_CRITERIA,
  SCORING_INTRO,
  siteFaq,
  SITE_MODES,
  spellNumber,
  BUILD_CATALOG_COUNTS,
} from "./siteContent";

test("the player range is built from the real multiplayer limits", () => {
  assert.equal(PLAYER_RANGE, `${MP_MIN_PLAYERS}–${MP_MAX_PLAYERS}`);
});

test("the round options text lists every configurable round count", () => {
  for (const option of MP_ROUND_OPTIONS) {
    assert.ok(ROUND_OPTIONS_TEXT.includes(String(option)), `missing round option ${option}`);
  }
  assert.equal(ROUND_OPTIONS_TEXT, formatOptionList(MP_ROUND_OPTIONS));
});

test("formatOptionList reads correctly however many options there are", () => {
  assert.equal(formatOptionList([]), "");
  assert.equal(formatOptionList([5]), "5");
  assert.equal(formatOptionList([5, 10]), "5 or 10");
  assert.equal(formatOptionList([5, 10, 15, 20]), "5, 10, 15 or 20");
});

test("the room-code wording tracks the real code length", () => {
  assert.equal(ROOM_CODE_LENGTH_WORD, spellNumber(MP_ROOM_CODE_LENGTH));
  const joining = MULTIPLAYER_FACTS.find((fact) => fact.label === "Joining");
  assert.ok(joining, "the multiplayer fact table must state how to join");
  assert.ok(joining.value.includes(String(MP_ROOM_CODE_LENGTH)));
});

test("the multiplayer fact table states the real clock and room length", () => {
  const clock = MULTIPLAYER_FACTS.find((fact) => fact.label === "Round clock");
  assert.ok(clock);
  assert.ok(clock.value.includes(`${MP_SHOW_SHAPE_SECONDS}s`), "study time must come from MP_TIMINGS");
  assert.ok(clock.value.includes(`${MP_DRAWING_SECONDS}s`), "draw time must come from MP_TIMINGS");

  const length = MULTIPLAYER_FACTS.find((fact) => fact.label === "Room length");
  assert.ok(length);
  assert.equal(length.value, `${ROUND_OPTIONS_TEXT} rounds`);

  const players = MULTIPLAYER_FACTS.find((fact) => fact.label === "Players");
  assert.ok(players);
  assert.ok(players.value.startsWith(PLAYER_RANGE));
});

test("multiplayer prose spells out the real limits and timings", () => {
  assert.ok(MULTIPLAYER_INTRO.includes(spellNumber(MP_MAX_PLAYERS)));
  assert.ok(MULTIPLAYER_INTRO.includes(spellNumber(MP_SHOW_SHAPE_SECONDS)));
  assert.ok(MULTIPLAYER_INTRO.includes(spellNumber(MP_DRAWING_SECONDS)));
});

test("every multiplayer round step exists and none invents a number", () => {
  assert.equal(MULTIPLAYER_ROUND_STEPS.length, 4);
  // Sentence-cased in the copy ("Three seconds to study, then twenty to draw"),
  // so the comparison is case-insensitive - the point is the NUMBER, not the case.
  const clockStep = MULTIPLAYER_ROUND_STEPS[1].body.toLowerCase();
  assert.ok(clockStep.includes(spellNumber(MP_SHOW_SHAPE_SECONDS)));
  assert.ok(clockStep.includes(spellNumber(MP_DRAWING_SECONDS)));
});

test("the 2 Players steps quote the real study and draw windows", () => {
  const steps = passPlaySteps();
  const drawing = steps.find((step) => step.title === "Player 1 draws");
  assert.ok(drawing);
  assert.ok(drawing.body.includes(String(MP_SHOW_SHAPE_SECONDS)));
  assert.ok(drawing.body.includes(String(MP_DRAWING_SECONDS)));

  const sameChallenge = steps[0];
  assert.ok(sameChallenge.body.includes(String(SHAPE_COUNT)), "the catalog size must come from the catalog");
});

test("the mode list covers exactly the three modes the site offers", () => {
  assert.deepEqual(
    SITE_MODES.map((mode) => mode.id),
    ["classic", "passPlay", "multiplayer"],
  );
  const multiplayer = SITE_MODES.find((mode) => mode.id === "multiplayer");
  assert.ok(multiplayer);
  assert.ok(multiplayer.meta.includes(PLAYER_RANGE));
  assert.ok(multiplayer.meta.includes(ROUND_OPTIONS_TEXT));
});

test("the scoring criteria carry the engine's real weights", () => {
  assert.equal(SCORING_CRITERIA.length, 4);
  assert.deepEqual(
    SCORING_CRITERIA.map((criterion) => criterion.weight).sort((a, b) => a - b),
    [
      SCORE_WEIGHT_PERCENTS.shapeMatch,
      SCORE_WEIGHT_PERCENTS.scale,
      SCORE_WEIGHT_PERCENTS.coverage,
      SCORE_WEIGHT_PERCENTS.smoothness,
    ].sort((a, b) => a - b),
  );
});

test("the heaviest criterion is derived, not asserted in copy", () => {
  const heaviest = SCORING_CRITERIA.reduce((a, b) => (b.weight > a.weight ? b : a));
  assert.equal(HEAVIEST_CRITERION.name, heaviest.name);
  assert.equal(HEAVIEST_CRITERION.weight, SCORE_WEIGHT_PERCENTS.shapeMatch);
  assert.ok(SCORING_INTRO.includes(`${HEAVIEST_CRITERION.weight}%`));
});

test("the FAQ states the catalog size and the multiplayer rules from source", () => {
  const faq = siteFaq();
  const shapes = faq.find((entry) => entry.question.includes("How many shapes"));
  assert.ok(shapes);
  assert.ok(shapes.answer.includes(String(SHAPE_COUNT)));
  assert.ok(shapes.answer.includes(String(CATEGORY_COUNT)));

  const together = faq.find((entry) => entry.question.includes("other people"));
  assert.ok(together);
  assert.ok(together.answer.includes(PLAYER_RANGE));
  assert.ok(together.answer.includes(ROUND_OPTIONS_TEXT));
  assert.ok(together.answer.includes(ROOM_CODE_LENGTH_WORD));

  const scoring = faq.find((entry) => entry.question.includes("score worked out"));
  assert.ok(scoring);
  assert.ok(scoring.answer.includes(`${SCORE_WEIGHT_PERCENTS.shapeMatch}%`));
});

test("spellNumber covers the range the copy actually uses, and degrades safely", () => {
  assert.equal(spellNumber(2), "two");
  assert.equal(spellNumber(3), "three");
  assert.equal(spellNumber(8), "eight");
  assert.equal(spellNumber(20), "twenty");
  assert.equal(spellNumber(276), "276");
});

test("the build-time defaults are the baked-in library's counts", () => {
  assert.deepEqual(BUILD_CATALOG_COUNTS, { shapes: SHAPE_COUNT, categories: CATEGORY_COUNT });
});

test("count-bearing copy follows whatever catalog it is given", () => {
  // The whole point of the builders: a remote content release changes what
  // contentRepository holds, and the client passes those counts in. Deliberately
  // NOT today's numbers - the copy must track the argument, not the bundle.
  const remote = { shapes: SHAPE_COUNT + 41, categories: CATEGORY_COUNT + 3 };

  const howMany = siteFaq(remote).find((entry) => entry.question.includes("How many shapes"));
  assert.ok(howMany);
  assert.ok(howMany.answer.includes(String(remote.shapes)), "shape count must come from the argument");
  assert.ok(howMany.answer.includes(String(remote.categories)), "category count must come from the argument");
  assert.ok(!howMany.answer.includes(String(SHAPE_COUNT)), "must not fall back to the build-time count");

  assert.ok(passPlaySteps(remote)[0].body.includes(String(remote.shapes)));
  assert.ok(!passPlaySteps(remote)[0].body.includes(`${SHAPE_COUNT}-shape`));
});

test("omitting the counts falls back to the build-time library, for the Worker", () => {
  assert.deepEqual(siteFaq(), siteFaq(BUILD_CATALOG_COUNTS));
  assert.deepEqual(passPlaySteps(), passPlaySteps(BUILD_CATALOG_COUNTS));
});
