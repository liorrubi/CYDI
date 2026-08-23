import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_STEPS, HOST_STEPS, LABEL_BY_ROLE, PASS_PLAY_STEPS, STEPS_BY_ROLE } from "./tutorialSteps";

const ALL = { host: HOST_STEPS, guest: GUEST_STEPS, passPlay: PASS_PLAY_STEPS };

test("each role gets its own list, and no two are the same", () => {
  const titles = Object.values(ALL).map((steps) => steps.map((s) => s.title).join("|"));
  assert.equal(new Set(titles).size, 3, "host, guest and 2 Players must be told different things");
  for (const [role, steps] of Object.entries(ALL)) {
    assert.equal(STEPS_BY_ROLE[role as keyof typeof ALL], steps);
    assert.ok(LABEL_BY_ROLE[role as keyof typeof ALL].length > 0, `${role} needs an accessible label`);
  }
  assert.equal(new Set(Object.values(LABEL_BY_ROLE)).size, 3, "and the dialogs must announce themselves differently");
});

test("every step is short enough to read on a phone", () => {
  for (const [role, steps] of Object.entries(ALL)) {
    assert.ok(steps.length >= 4 && steps.length <= 5, `${role} has ${steps.length} steps`);
    for (const step of steps) {
      assert.ok(step.icon.length > 0, `${role}: every step needs an icon`);
      assert.ok(step.title.length <= 44, `${role}: "${step.title}" is too long for a heading`);
      assert.ok(step.body.length <= 170, `${role}: "${step.title}" body is ${step.body.length} chars`);
    }
  }
});

test("the host is told the things only a host can do", () => {
  const text = HOST_STEPS.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
  for (const topic of ["create", "invite", "start", "next round"]) {
    assert.ok(text.includes(topic), `the host tutorial should mention ${topic}`);
  }
});

test("the guest is never told about controls they do not have", () => {
  const text = GUEST_STEPS.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
  assert.ok(text.includes("join"), "a guest joins");
  assert.ok(!text.includes("start game"), "a guest has no Start Game button");
  assert.ok(!text.includes("next round"), "and does not control the pace");
  assert.ok(!text.includes("create a room"), "and does not create the room");
});

test("2 Players explains the one-device mechanic and the hidden scores", () => {
  const text = PASS_PLAY_STEPS.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
  assert.ok(text.includes("one device"), "the whole premise");
  assert.ok(text.includes("turn"), "taken in turns");
  assert.ok(!text.includes("room code") && !text.includes("qr"), "there is no room and no code in this mode");
});

test("the pre-game tutorials never mention Social Points", () => {
  // Social Rank is explained after a match actually pays out, not promised
  // before one is played.
  for (const [role, steps] of Object.entries(ALL)) {
    const text = steps.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
    assert.ok(!text.includes("social point"), `${role} must not pre-explain Social Points`);
    assert.ok(!text.includes("social rank"), `${role} must not pre-explain Social Rank`);
  }
});

test("every tutorial states the 20-second window rather than a stale one", () => {
  for (const [role, steps] of Object.entries(ALL)) {
    const text = steps.map((s) => `${s.title} ${s.body}`).join(" ");
    assert.ok(!text.includes("30 second") && !text.includes("30-second"), `${role} still mentions a 30-second round`);
    if (text.includes("second")) assert.ok(text.includes("20 seconds"), `${role} should say 20 seconds`);
  }
});
