// 0.57.0 pre-deploy verification (sections K + L), Worker side. Added by the compat-verify pass; touches no
// existing file. Proves, with the real shipped code:
//   K  old (0.55/0.56) clients vs the NEW RoomDO: 15-round rooms, no bad_frame, a full 15-round game, a 3-round
//      room as seen by a client that does not validate snapshots, host promotion, rematch / gameSerial facts.
//   L  every analytics payload the release touched: 0.55 / 0.56 payloads still validate (exact-key rules), the
//      0.57-only shapes and their strict negatives, AE slot mapping + no slot collision, exact-ledger /
//      telemetry classification parity, shedding, DO counters, envelope size, and the three config bodies.
// The OLD-schema direction (what an old Worker would drop) needs the base code and is covered by the scratch
// script in the verification report, not here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RoomDO } from "./roomDO.ts";
import { getShapeById } from "../src/engine/shapeLibrary.ts";
import { resampleAllSegments, splitIntoSegments } from "../src/engine/normalizePath.ts";
import { MP_TIMINGS, toWirePath } from "../src/multiplayer/protocol.ts";
import type { RoomSnapshot, ServerFrame } from "../src/multiplayer/protocol.ts";

const worker = (await import("./index.ts")).default;
const { ANALYTICS_EVENT_NAMES, validateEventParams } = await import("../src/services/analyticsSchema.ts");
const { CLIENT_EXACT_EVENTS, CLIENT_DIAGNOSTIC_EVENTS, classifyEvent } = await import("../src/services/analyticsEventClasses.ts");
const { EXACT_LEDGER_EVENTS, splitForLedger } = await import("./analyticsExactLedger.ts");
const { ALWAYS_PRESERVE } = await import("./analyticsShedding.ts");
const { buildShadowDataPoints } = await import("./analyticsShadow.ts");
const { incrementEvent, MAX_BODY_BYTES } = await import("./analyticsDO.ts");
const interstitial = await import("../src/services/ads/interstitialConfigSchema.ts");

// ============================================================ K: RoomDO with old-client frames ====

class FakeWS {
  sent: ServerFrame[] = [];
  attachment: unknown = null;
  closed = false;
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as ServerFrame);
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  close() {
    this.closed = true;
  }
  last<T extends ServerFrame["type"]>(type: T): Extract<ServerFrame, { type: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].type === type) return this.sent[i] as Extract<ServerFrame, { type: T }>;
    return undefined;
  }
  snapshot(): RoomSnapshot {
    const s = this.last("snapshot");
    assert.ok(s, "expected a snapshot");
    return s;
  }
}
class FakeStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put(key: string, value: unknown) {
    this.map.set(key, structuredClone(value));
  }
  async deleteAll() {
    this.map.clear();
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}
class FakeState {
  storage = new FakeStorage();
  sockets: FakeWS[] = [];
  acceptWebSocket(ws: FakeWS) {
    this.sockets.push(ws);
  }
  getWebSockets(): FakeWS[] {
    return this.sockets.filter((w) => !w.closed);
  }
  setWebSocketAutoResponse() {}
}
(globalThis as Record<string, unknown>).WebSocketRequestResponsePair = class {
  request: string;
  response: string;
  constructor(request: string, response: string) {
    this.request = request;
    this.response = response;
  }
};

let clock = 1_700_000_000_000;
const realNow = Date.now;
test.before(() => {
  Date.now = () => clock;
});
test.after(() => {
  Date.now = realNow;
});
const advance = (ms: number) => {
  clock += ms;
};

async function makeLobby() {
  clock = 1_700_000_000_000;
  const state = new FakeState();
  const room = new RoomDO(state as unknown as DurableObjectState);
  const res = await room.fetch(new Request("https://room.internal/create?code=COMPAT", { method: "POST" }));
  assert.equal(res.status, 200);
  // Raw JSON strings: exactly what crosses the wire from an installed client.
  const sendRaw = (ws: FakeWS, raw: string) => room.webSocketMessage(ws as unknown as WebSocket, raw);
  const send = (ws: FakeWS, frame: unknown) => sendRaw(ws, JSON.stringify(frame));
  const connect = () => {
    const ws = new FakeWS();
    state.acceptWebSocket(ws);
    ws.serializeAttachment({ seatId: null, rateWindowStart: Date.now(), rateCount: 0 });
    return ws;
  };
  const host = connect();
  const guest = connect();
  await send(host, { type: "join", nickname: "OldHost", playerId: "p-host" });
  await send(guest, { type: "join", nickname: "Guest", playerId: "p-guest" });
  return { room, state, host, guest, send, sendRaw, connect, alarm: () => room.alarm() };
}
type Lobby = Awaited<ReturnType<typeof makeLobby>>;

async function toDrawing(h: Lobby) {
  advance(MP_TIMINGS.COUNTDOWN_MS);
  await h.alarm();
  advance(MP_TIMINGS.SHOW_SHAPE_MS);
  await h.alarm();
  assert.equal(h.host.snapshot().phase, "DRAWING");
}
function attempt(shapeId: string, canvas = 320) {
  const shape = getShapeById(shapeId);
  assert.ok(shape);
  const target = shape.generate(canvas);
  const segs = splitIntoSegments(target.points, target.breaks).filter((s) => s.length > 1);
  const { points, segmentStarts } = resampleAllSegments(segs, 200);
  return toWirePath({ points, canvasWidth: canvas, canvasHeight: canvas, breaks: segmentStarts });
}
async function playToEnd(h: Lobby, rounds: number) {
  const labels: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const s = h.host.snapshot();
    assert.equal(s.roundIndex, i);
    assert.equal(s.rounds, rounds);
    labels.push(`Round ${s.roundIndex + 1} of ${s.rounds}`);
    await h.send(h.host, { type: "submit", roundIndex: i, path: attempt(s.shapeId!) });
    await h.send(h.guest, { type: "submit", roundIndex: i, path: null });
    const phase = h.host.snapshot().phase;
    if (i < rounds - 1) {
      assert.equal(phase, "ROUND_RESULTS", `round ${i}`);
      await h.send(h.host, { type: "next" });
      await toDrawing(h);
    } else {
      assert.equal(phase, "FINAL_RESULTS");
    }
  }
  return labels;
}

test("K: an old host's configure frame (rounds 15, exact base-client JSON) is accepted: no bad_frame, a guest joins, 15 rounds complete", async () => {
  const h = await makeLobby();
  // The base client sends { type: "configure", rounds, difficulty } with the host's chosen values.
  await h.sendRaw(h.host, '{"type":"configure","rounds":15,"difficulty":"mixed"}');
  assert.equal(h.host.last("error"), undefined, "configure(15) must not be answered with bad_frame");
  assert.equal(h.guest.snapshot().rounds, 15);
  await h.send(h.host, { type: "start" });
  await toDrawing(h);
  const labels = await playToEnd(h, 15);
  assert.equal(labels[0], "Round 1 of 15");
  assert.equal(labels[14], "Round 15 of 15");
  assert.equal(h.host.snapshot().phase, "FINAL_RESULTS");
  assert.equal(h.host.snapshot().roundIndex, 14);
  for (const ws of [h.host, h.guest]) assert.equal(ws.last("error"), undefined, "no error frame at any point of a 15-round game");
});

test("K: rematch keeps the length, gameSerial moves on Start only (rematch -> Start is a new game)", async () => {
  const h = await makeLobby();
  await h.send(h.host, { type: "configure", rounds: 3, difficulty: "easy" });
  assert.equal(h.host.snapshot().gameSerial, 0, "fresh room");
  await h.send(h.host, { type: "start" });
  assert.equal(h.host.snapshot().gameSerial, 1);
  await toDrawing(h);
  await playToEnd(h, 3);
  assert.equal(h.host.snapshot().gameSerial, 1);
  await h.send(h.host, { type: "rematch" });
  assert.equal(h.host.snapshot().phase, "LOBBY");
  assert.equal(h.host.snapshot().gameSerial, 1, "rematch alone does not bump the serial");
  assert.equal(h.host.snapshot().rounds, 3, "the length survives the rematch");
  await h.send(h.host, { type: "start" });
  assert.equal(h.host.snapshot().gameSerial, 2, "the rematch becomes a game on Start and gets its own key");
});

test("K: a 3-round room as an old client sees it: same snapshot key set as 0.56, rounds is a plain number, label is generic", async () => {
  const h = await makeLobby();
  await h.send(h.host, { type: "configure", rounds: 3, difficulty: "mixed" });
  const wire = h.guest.snapshot() as unknown as Record<string, unknown>;
  // The 0.56 RoomSnapshot type (git show b45248b:src/multiplayer/protocol.ts) - an old client does JSON.parse as ServerFrame.
  const base056 = ["type", "roomCode", "phase", "phaseStartsAt", "phaseEndsAt", "serverNow", "rounds", "difficulty", "roundIndex", "shapeId", "players", "lastRound", "championSeatId", "gameSerial", "you"];
  assert.deepEqual(Object.keys(wire).sort(), [...base056].sort(), "the snapshot wire shape is unchanged");
  assert.equal(wire.rounds, 3);
  await h.send(h.host, { type: "start" });
  await toDrawing(h);
  const labels = await playToEnd(h, 3);
  assert.deepEqual(labels, ["Round 1 of 3", "Round 2 of 3", "Round 3 of 3"]);
  assert.equal(h.guest.snapshot().phase, "FINAL_RESULTS");
});

test("K: a promoted host of any version re-sends the room's current length on a difficulty click (3 and 15 both accepted)", async () => {
  for (const rounds of [3, 15]) {
    const h = await makeLobby();
    await h.send(h.host, { type: "configure", rounds, difficulty: "mixed" });
    h.host.closed = true;
    await h.room.webSocketClose(h.host as unknown as WebSocket);
    assert.equal(h.guest.snapshot().you?.isHost, true, "the remaining player is promoted in the lobby");
    h.guest.sent.length = 0;
    // What both the 0.56 and the 0.57 lobby send on a difficulty chip: rounds = the room's current value.
    await h.send(h.guest, { type: "configure", rounds, difficulty: "hard" });
    assert.equal(h.guest.last("error"), undefined, `${rounds}-round room: difficulty click by the promoted host`);
    assert.equal(h.guest.snapshot().difficulty, "hard");
    assert.equal(h.guest.snapshot().rounds, rounds);
  }
});

test("K: room creation takes no round length (so no creation-time validation path exists beyond configure)", () => {
  const src = readFileSync(new URL("../src/multiplayer/roomApi.ts", import.meta.url), "utf8");
  assert.match(src, /method: "POST"/);
  assert.doesNotMatch(src.slice(src.indexOf("export async function createRoom"), src.indexOf("export type LookupResult")), /rounds|roundCount/);
  const room = readFileSync(new URL("./roomDO.ts", import.meta.url), "utf8");
  const users = [...room.matchAll(/isRoundCount|ROUND_COUNT_/g)].length;
  assert.equal(users, 0, "RoomDO validates the length only through parseClientFrame");
});

// ==================================================================== L: analytics compatibility ====

const econ = { balanceBucket: "100_499", baseReward: 20, multiplier: 3, adAvailable: true, nextTarget: "category", shortfallBucket: "short_0_10", adClosesGap: true, gamesBucket: "10_24" };
const exp = { arm: "x3", offerNumber: 2, sessionGames: 4, bonusCoins: 40, interstitialArm: "treatment" };
const plc = { placement: "shape_challenge_double_reward" };
const fun = { gameType: "shapeChallenge", category: "animals", contentKey: "cat" };
const diag = { attempt: 1, code: 3, latency: "lt5s" };
const ifx = { ifxCell: "B", ifxVersion: 2, ifxCap: 2 };
const summary = { arm: "treatment", classicGames: 6, checkpoints: 2, shown: 1, notReady: 1, secondReached: 1, rewardedShown: 1, rewardedDeferred: 0, cadence: 7, cap: 2 };

type Case = [event: string, label: string, params: Record<string, unknown>];
/** What 0.55 / 0.56 clients emit for every event the release touched (all of these validated on the pre-0.57 schema). */
const OLD_CLIENT: Case[] = [
  ["mp_room_created", "5", { roundCount: 5, difficulty: "mixed" }],
  ["mp_room_created", "15", { roundCount: 15, difficulty: "hard" }],
  ["mp_game_started", "15", { playerCount: 3, roundCount: 15, difficulty: "mixed" }],
  ["mp_game_finished", "15", { playerCount: 3, roundCount: 15 }],
  ["pp_game_started", "15", { playerCount: 2, roundCount: 15, difficulty: "medium" }],
  ["pp_game_finished", "15", { playerCount: 2, roundCount: 15 }],
  ["pp_abandoned", "15", { roundIndex: 14, playerCount: 2, roundCount: 15 }],
  ["reward_skipped", "0.55 bare", plc],
  ["reward_skipped", "0.56 economy", { ...plc, ...econ }],
  ["reward_skipped", "0.56 economy+exp", { ...plc, ...econ, ...exp }],
  ["reward_bonus_skipped", "0.56 economy+exp", { ...plc, ...econ, ...exp }],
  ["reward_offer_shown", "0.56 economy+exp", { ...plc, ...econ, ...exp }],
  ["reward_ad_started", "0.56 economy+exp", { ...plc, ...econ, ...exp }],
  ["reward_ad_completed", "0.56 economy+exp", { ...plc, ...econ, ...exp }],
  ["reward_ad_failed", "0.56 economy+exp", { ...plc, ...econ, ...exp }],
  ["reward_bonus_offer_shown", "0.56 exp interstitialArm none", { ...plc, ...econ, ...exp, interstitialArm: "none" }],
  ["interstitial_checkpoint", "control", { arm: "control", outcome: "control", gamesBetweenAds: 7 }],
  ["interstitial_checkpoint", "control suppressed", { arm: "control", outcome: "suppressed", gamesBetweenAds: 10 }],
  ["interstitial_checkpoint", "treatment shown", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7 }],
  ["interstitial_checkpoint", "not_ready+diag", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 5, ...diag }],
  ["interstitial_checkpoint", "show_failed", { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 12, reason: "no_fill", ...diag }],
  ["interstitial_continuation", "treatment", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7 }],
  ["interstitial_continuation", "control", { arm: "control", outcome: "control", gamesBetweenAds: 20 }],
  ["reward_continuation", "0.56", { arm: "x3", offerNumber: 2, outcome: "completed" }],
  ["game_completed", "0.55", fun],
  ["game_completed", "0.55 coins", { ...fun, coinsEarned: 20, balanceBucket: "100_499" }],
];
/** Shapes only a 0.57 client emits. */
const NEW_ONLY: Case[] = [
  ["mp_room_created", "3 rounds", { roundCount: 3, difficulty: "mixed" }],
  ["mp_game_started", "3 rounds", { playerCount: 2, roundCount: 3, difficulty: "mixed" }],
  ["mp_game_started", "ordinal 1", { playerCount: 2, roundCount: 5, difficulty: "mixed", mpDailyOrdinal: 1 }],
  ["mp_game_started", "ordinal 7", { playerCount: 4, roundCount: 10, difficulty: "hard", mpDailyOrdinal: 7 }],
  ["mp_game_started", "ordinal + 15 rounds (new client in an old host's room)", { playerCount: 4, roundCount: 15, difficulty: "hard", mpDailyOrdinal: 2 }],
  ["mp_game_finished", "3 rounds", { playerCount: 2, roundCount: 3 }],
  ["pp_game_started", "3 rounds", { playerCount: 2, roundCount: 3, difficulty: "medium" }],
  ["pp_game_finished", "3 rounds", { playerCount: 2, roundCount: 3 }],
  ["pp_abandoned", "3 rounds", { roundIndex: 1, playerCount: 2, roundCount: 3 }],
  ["reward_skipped", "skipStage offer bare", { ...plc, skipStage: "offer" }],
  ["reward_skipped", "skipStage ad economy", { ...plc, ...econ, skipStage: "ad" }],
  ["reward_skipped", "skipStage exp", { ...plc, ...econ, ...exp, skipStage: "offer" }],
  ["reward_skipped", "skipStage exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "C", skipStage: "ad" }],
  ["reward_bonus_skipped", "skipStage ad economy", { ...plc, ...econ, skipStage: "ad" }],
  ["reward_bonus_skipped", "skipStage exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "A", skipStage: "offer" }],
  ["reward_offer_shown", "exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "D" }],
  ["reward_ad_started", "exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "D" }],
  ["reward_ad_completed", "exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "D" }],
  ["reward_ad_failed", "exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "D" }],
  ["reward_bonus_offer_shown", "exp ifxCell", { ...plc, ...econ, ...exp, ifxCell: "F" }],
  ["interstitial_checkpoint", "cadence 6 control", { arm: "control", outcome: "control", gamesBetweenAds: 6 }],
  ["interstitial_checkpoint", "cadence 9 treatment", { arm: "treatment", outcome: "shown", gamesBetweenAds: 9 }],
  ["interstitial_checkpoint", "cadence 3 cap 5 (envelope corner)", { arm: "treatment", outcome: "shown", gamesBetweenAds: 3, ifxCell: "C", ifxVersion: 1, ifxCap: 5 }],
  ["interstitial_checkpoint", "cadence 4 cap 3", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 4, ifxCell: "D", ifxVersion: 1, ifxCap: 3 }],
  ["interstitial_continuation", "cadence 3 cap 4", { arm: "treatment", outcome: "shown", gamesBetweenAds: 3, ifxCell: "A", ifxVersion: 1, ifxCap: 4 }],
  ["session_summary", "participant 3/5", { ...summary, cadence: 3, cap: 5, ifxCell: "C", ifxVersion: 1 }],
  ["interstitial_checkpoint", "legacy cadence + ifx", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7, ...ifx }],
  ["interstitial_checkpoint", "control + ifx", { arm: "control", outcome: "control", gamesBetweenAds: 7, ...ifx }],
  ["interstitial_checkpoint", "show_failed diag ifx", { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 12, reason: "timeout", ...diag, ...ifx }],
  ["interstitial_continuation", "cadence 8", { arm: "treatment", outcome: "shown", gamesBetweenAds: 8 }],
  ["interstitial_continuation", "legacy cadence + ifx", { arm: "treatment", outcome: "shown", gamesBetweenAds: 10, ...ifx }],
  ["game_completed", "nextOutcome", { ...fun, nextOutcome: "shown" }],
  ["game_completed", "nextOutcome ifxCell", { ...fun, nextOutcome: "control", ifxCell: "E" }],
  ["game_completed", "coins nextOutcome", { ...fun, coinsEarned: 20, balanceBucket: "100_499", nextOutcome: "not_ready" }],
  ["game_completed", "coins nextOutcome ifxCell", { ...fun, coinsEarned: 20, balanceBucket: "100_499", nextOutcome: "suppressed", ifxCell: "A" }],
  ["session_summary", "baseline", summary],
  ["session_summary", "participant", { ...summary, ifxCell: "B", ifxVersion: 3 }],
  ["session_summary", "control", { ...summary, arm: "control", shown: 0, notReady: 0, cadence: 6 }],
];

test("L(1): every 0.55 / 0.56 payload of every touched event still validates on the new schema (exact-key rules, old direction)", () => {
  for (const [event, label, params] of OLD_CLIENT) {
    assert.equal(validateEventParams(event as never, params as never).valid, true, `${event} (${label}) must stay valid`);
  }
});

test("L(2): every 0.57-only payload validates on the new schema", () => {
  for (const [event, label, params] of NEW_ONLY) {
    assert.equal(validateEventParams(event as never, params as never).valid, true, `${event} (${label})`);
  }
});

test("L(2b): the new optional keys are strict - partial, misplaced, out-of-range and unknown shapes are all rejected", () => {
  const bad: Case[] = [
    ["mp_game_started", "ordinal 0", { playerCount: 2, roundCount: 5, difficulty: "mixed", mpDailyOrdinal: 0 }],
    ["mp_game_started", "ordinal 8", { playerCount: 2, roundCount: 5, difficulty: "mixed", mpDailyOrdinal: 8 }],
    ["mp_game_started", "ordinal + extra key", { playerCount: 2, roundCount: 5, difficulty: "mixed", mpDailyOrdinal: 1, x: 1 }],
    ["mp_game_started", "round 4", { playerCount: 2, roundCount: 4, difficulty: "mixed" }],
    ["reward_skipped", "skipStage bogus", { ...plc, skipStage: "later" }],
    ["reward_skipped", "skipStage on a partial economy", { ...plc, balanceBucket: "100_499", skipStage: "ad" }],
    ["reward_ad_started", "skipStage is skip-only", { ...plc, skipStage: "ad" }],
    ["reward_offer_shown", "ifxCell without the experiment block", { ...plc, ...econ, ifxCell: "A" }],
    ["reward_offer_shown", "ifxCell with interstitialArm none", { ...plc, ...econ, ...exp, interstitialArm: "none", ifxCell: "A" }],
    ["reward_offer_shown", "unknown cell", { ...plc, ...econ, ...exp, ifxCell: "G" }],
    ["interstitial_checkpoint", "partial ifx (cell only)", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7, ifxCell: "A" }],
    ["interstitial_checkpoint", "ifx cap 6", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7, ifxCell: "A", ifxVersion: 1, ifxCap: 6 }],
    ["interstitial_checkpoint", "ifx cap 0", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7, ifxCell: "A", ifxVersion: 1, ifxCap: 0 }],
    ["interstitial_checkpoint", "cadence 2", { arm: "control", outcome: "control", gamesBetweenAds: 2 }],
    ["interstitial_checkpoint", "cadence 21", { arm: "control", outcome: "control", gamesBetweenAds: 21 }],
    ["interstitial_checkpoint", "cadence 7.5", { arm: "control", outcome: "control", gamesBetweenAds: 7.5 }],
    ["interstitial_continuation", "partial ifx", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7, ifxVersion: 1, ifxCap: 1 }],
    ["game_completed", "ifxCell without nextOutcome", { ...fun, ifxCell: "A" }],
    ["game_completed", "nextOutcome on a non-Classic game", { ...fun, gameType: "dailyChallenge", nextOutcome: "shown" }],
    ["game_completed", "unknown nextOutcome", { ...fun, nextOutcome: "maybe" }],
    ["session_summary", "missing key", Object.fromEntries(Object.entries(summary).filter(([k]) => k !== "cap"))],
    ["session_summary", "classicGames 0 (a segment without a game emits nothing)", { ...summary, classicGames: 0 }],
    ["session_summary", "shown + notReady > checkpoints", { ...summary, shown: 2, notReady: 1 }],
    ["session_summary", "control that shows", { ...summary, arm: "control" }],
    ["session_summary", "ifxCell without ifxVersion", { ...summary, ifxCell: "A" }],
    ["session_summary", "unknown extra key (an id)", { ...summary, installationId: "abc" }],
    ["session_summary", "count 100", { ...summary, classicGames: 100 }],
    ["session_summary", "cap 6", { ...summary, cap: 6 }],
    ["session_summary", "cap 0", { ...summary, cap: 0 }],
    ["session_summary", "cadence 2", { ...summary, cadence: 2 }],
    ["session_summary", "cadence 21", { ...summary, cadence: 21 }],
  ];
  for (const [event, label, params] of bad) assert.equal(validateEventParams(event as never, params as never).valid, false, `${event} (${label}) must be rejected`);
});

test("L(3): classification parity - client EXACT list equals the Worker ledger list; every touched event keeps / gets the intended class", () => {
  assert.deepEqual([...CLIENT_EXACT_EVENTS].sort(), [...EXACT_LEDGER_EVENTS].sort());
  for (const e of ["interstitial_checkpoint", "interstitial_continuation", "reward_ad_started", "reward_ad_completed", "reward_ad_failed", "reward_bonus_ad_started", "reward_bonus_ad_completed", "reward_bonus_ad_failed", "mp_room_created"]) {
    assert.equal(EXACT_LEDGER_EVENTS.has(e), true, `${e} stays exact`);
  }
  for (const e of ["session_summary", "mp_game_started", "mp_game_finished", "game_completed", "reward_skipped", "reward_bonus_skipped", "reward_offer_shown", "reward_bonus_offer_shown", "reward_continuation", "pp_game_started", "pp_game_finished", "pp_abandoned"]) {
    assert.equal(EXACT_LEDGER_EVENTS.has(e), false, `${e} stays telemetry`);
    assert.equal(CLIENT_EXACT_EVENTS.has(e), false);
    assert.equal(classifyEvent(e), CLIENT_DIAGNOSTIC_EVENTS.has(e) ? "diagnostic" : "telemetry");
  }
  assert.ok(ANALYTICS_EVENT_NAMES.includes("session_summary"));
  assert.equal(ALWAYS_PRESERVE.includes("session_summary"), false, "session_summary is sheddable / sampled like any telemetry event");
  for (const e of EXACT_LEDGER_EVENTS) if (e !== "interstitial_checkpoint" && e !== "interstitial_continuation") assert.ok(ALWAYS_PRESERVE.includes(e), `${e} (exact) is also never shed`);
});

test("L(3b): a batch holding session_summary + an ifx checkpoint splits telemetry / exact; nothing new is exact", () => {
  const env = (eventName: string, params: Record<string, unknown>) => ({ eventName, params, platform: "android", appVersion: "0.57.0", appVersionCode: 57, sessionId: "s", installationId: "i" });
  const body = JSON.stringify({
    events: [
      env("session_summary", summary),
      env("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 9, ...ifx }),
      env("mp_game_started", { playerCount: 2, roundCount: 3, difficulty: "mixed", mpDailyOrdinal: 1 }),
      env("game_completed", { ...fun, nextOutcome: "shown" }),
    ],
  });
  const split = splitForLedger("/events", body);
  assert.ok(split);
  assert.deepEqual(split.exact.map((e) => (e as { eventName: string }).eventName), ["interstitial_checkpoint"]);
  assert.deepEqual(split.telemetry.map((e) => (e as { eventName: string }).eventName), ["session_summary", "mp_game_started", "game_completed"]);
});

function point(event: string, params: Record<string, unknown>) {
  const env = { eventName: event, params, platform: "android", appVersion: "0.57.0", appVersionCode: 57, installationId: "i", sessionId: "s", isInternal: false };
  const pts = buildShadowDataPoints("/events", JSON.stringify({ events: [env] }), "US", () => 0.5);
  assert.equal(pts.length, 1, `${event} must produce one AE point`);
  return pts[0];
}
const d = (p: { doubles: number[] }, n: number) => p.doubles[n - 1];
const b = (p: { blobs: string[] }, n: number) => p.blobs[n - 1];

test("L(4): AE slot mapping for every new field, with the documented positions", () => {
  assert.equal(d(point("mp_game_started", { playerCount: 2, roundCount: 3, difficulty: "mixed", mpDailyOrdinal: 5 }), 9), 5, "double9 = mpDailyOrdinal");
  assert.equal(d(point("mp_game_started", { playerCount: 2, roundCount: 3, difficulty: "mixed" }), 9), 0, "absent ordinal = 0");
  assert.equal(d(point("mp_game_started", { playerCount: 2, roundCount: 3, difficulty: "mixed" }), 5), 3, "double5 stays roundCount (3 now valid)");
  assert.equal(b(point("reward_skipped", { ...plc, skipStage: "ad" }), 20), "skipStage:ad");
  assert.equal(b(point("reward_bonus_skipped", { ...plc, ...econ, skipStage: "offer" }), 20), "skipStage:offer");
  assert.equal(b(point("reward_skipped", plc), 20), "", "older build: empty detail");
  const cp = point("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 9, ...ifx });
  assert.deepEqual([d(cp, 9), d(cp, 10), d(cp, 11), d(cp, 12)], [9, 2, 2, 2], "cadence, ifxCap, ifxVersion, ifxCell(B=2)");
  assert.deepEqual([b(cp, 18), b(cp, 19)], ["treatment", "shown"]);
  const co = point("interstitial_checkpoint", { arm: "control", outcome: "control", gamesBetweenAds: 7 });
  assert.deepEqual([d(co, 10), d(co, 11), d(co, 12)], [0, 0, 0], "non-participant: ifx slots are 0");
  const rw = point("reward_ad_completed", { ...plc, ...econ, ...exp, ifxCell: "D" });
  assert.equal(d(rw, 12), 4, "ifxCell D = 4");
  assert.equal(d(rw, 10), 40, "double10 still bonusCoins on reward rows (economy report reads it)");
  assert.deepEqual([d(rw, 5), d(rw, 6)], [4, 2], "sessionGames / offerNumber unchanged");
  const gc = point("game_completed", { ...fun, coinsEarned: 20, balanceBucket: "100_499", nextOutcome: "control", ifxCell: "E" });
  assert.equal(b(gc, 19), "control");
  assert.equal(d(gc, 12), 5);
  assert.equal(d(gc, 18), 20, "coins slot untouched by the new fields");
  const ss = point("session_summary", { ...summary, ifxCell: "B", ifxVersion: 3 });
  assert.deepEqual(ss.doubles.slice(0, 13), [3, 6, 2, 1, 1, 1, 1, 0, 7, 2, 3, 2, 1], "schema 3, own layout, batch size 1");
  assert.deepEqual([b(ss, 1), b(ss, 8), b(ss, 18)], ["session_summary", "classic", "treatment"]);
  assert.equal(d(ss, 20), 1, "sampleWeight slot unchanged");
  assert.equal(ss.doubles.length, 20);
});

test("L(4b): old payloads' AE rows keep every slot they had (new slots read 0)", () => {
  for (const [event, label, params] of OLD_CLIENT) {
    const p = point(event, params);
    if (event === "mp_game_started") assert.equal(d(p, 9), 0, `${event} ${label}`);
    if (event.startsWith("interstitial_")) assert.deepEqual([d(p, 10), d(p, 11), d(p, 12)], [0, 0, 0], `${event} ${label}`);
    if (event.startsWith("reward_") && event !== "reward_continuation") assert.equal(d(p, 12), 0, `${event} ${label}: no ifxCell`);
    if (event === "game_completed") assert.equal(b(p, 19), "", `${event} ${label}`);
  }
});

test("L(4c): the AE / economy report queries do not read the reused slots for any other event", () => {
  const ae = readFileSync(new URL("./analyticsAeReport.ts", import.meta.url), "utf8");
  const eco = readFileSync(new URL("./analyticsEconomyReport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ae + eco, /double(9|11|12)\b/, "no report reads double9 / double11 / double12");
  // double10 is read only for coin_earned (amount) and reward_ad_completed / reward_bonus_ad_completed (bonusCoins) - events that never carry ifxCap.
  for (const m of eco.matchAll(/double10[^`]*?blob1 (?:=|IN) ([^A-Z]*)/g)) assert.match(m[1], /coin_earned|reward_ad_completed/, m[0].slice(0, 120));
  // The AE detail query reads double5/6 as roundCount / roundIndex only for the pp_* breakout events; session_summary (double5 = notReady) must not be one of them.
  assert.doesNotMatch(ae, /session_summary/);
  assert.match(ae, /ROUND_COUNT_BREAKOUT_EVENTS\.has\(ev as never\)/);
});

test("L(5): DO counter effects - no new breakout for any new field; the cadence map stays at most 16 keys", () => {
  for (const [event, , params] of NEW_ONLY) {
    const v = validateEventParams(event as never, params as never);
    assert.equal(v.valid, true);
    const out = incrementEvent({}, event as never, v.valid ? (v.params as never) : ({} as never), "android", "0.57.0", "b", undefined, "US", "57") as Record<string, Record<string, unknown>>;
    const keys = Object.keys(Object.values(out)[0]).sort();
    for (const k of keys) assert.ok(!/ifx|skipStage|ordinal|nextOutcome|session/i.test(k), `${event}: unexpected DO counter ${k}`);
    if (event === "session_summary") assert.deepEqual(keys, ["byAppVersion", "byPlatform", "total"]);
  }
  let counters: Record<string, unknown> = {};
  for (let cadence = 5; cadence <= 20; cadence++) {
    for (const ev of ["interstitial_checkpoint", "interstitial_continuation"] as const) {
      counters = incrementEvent(counters as never, ev, { arm: "control", outcome: "control", gamesBetweenAds: cadence }, "android", "0.57.0") as never;
    }
  }
  for (const ev of ["interstitial_checkpoint", "interstitial_continuation"]) assert.equal(Object.keys((counters[ev] as { byCadence: object }).byCadence).length, 16);
});

test("L(6): the largest new envelopes stay far below the 1536-byte per-request cap", () => {
  let max = 0;
  for (const [event, , params] of NEW_ONLY) {
    const env = { eventName: event, params, platform: "android", appVersion: "0.57.0", appBuild: "20261003", appVersionCode: 57, installationId: "x".repeat(36), sessionId: "y".repeat(36), isInternal: false, eventId: "z".repeat(36), keepPercent: 10 };
    max = Math.max(max, JSON.stringify(env).length);
  }
  assert.ok(max < MAX_BODY_BYTES * 0.6, `largest new envelope ${max} B vs cap ${MAX_BODY_BYTES}`);
});

// ------------------------------------------------------------------ config endpoints ----

class FakeKv {
  store = new Map<string, string>();
  gets: string[] = [];
  async get(key: string) {
    this.gets.push(key);
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}
const req = (path: string, init: RequestInit = {}, country = "DE") => {
  const r = new Request(`https://playcydi.com${path}`, init);
  Object.defineProperty(r, "cf", { value: { country }, configurable: true });
  return r;
};
const STORED = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, blockedCountries: ["IR"], secondOpportunityRolloutPercent: 50, rewardedLifecycleV2: false };
const EXPERIMENTS = { interstitial: { enabled: true, rolloutPercentInTreatment: 50, version: 2, cells: [{ id: "A", cadence: 7, cap: 1, weight: 50 }, { id: "B", cadence: 6, cap: 2, weight: 50 }] } };

test("L(7): config endpoints per client generation - legacy (0.55), ?v=2 (0.56) never see experiments; ?v=3 (0.57) does; +1 KV read for v3 only", async () => {
  const kv = new FakeKv();
  kv.store.set(interstitial.INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(STORED));
  kv.store.set(interstitial.INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(EXPERIMENTS));
  const env = { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: "t" } as never;
  const get = async (q: string) => {
    kv.gets.length = 0;
    const res = await worker.fetch(req(`/api/config/ads/interstitial${q}`), env);
    assert.equal(res.status, 200);
    return { body: (await res.json()) as Record<string, unknown>, reads: kv.gets.length, cache: res.headers.get("cache-control") };
  };
  const legacy = await get("");
  assert.deepEqual(Object.keys(legacy.body).sort(), ["countryEligible", "enabled", "gamesBetweenAds", "maxOpportunitiesPerSession", "rolloutPercent"]);
  assert.equal(legacy.body.rolloutPercent, 50, "capped at the released schema maximum");
  assert.equal(interstitial.isValidLegacyInterstitialClientConfig(legacy.body), true);
  assert.equal(legacy.reads, 1);

  const v2 = await get("?v=2");
  assert.equal(v2.body.experiments, undefined);
  assert.equal(v2.body.rolloutPercent, 80);
  assert.equal(v2.body.secondOpportunityRolloutPercent, 50);
  assert.equal(v2.body.rewardedLifecycleV2, false);
  assert.equal(interstitial.isValidInterstitialClientConfig(v2.body), true, "a 0.56 client validates it");
  assert.equal(v2.reads, 1);

  const v3 = await get("?v=3");
  assert.deepEqual(v3.body.experiments, EXPERIMENTS);
  const { experiments: _omit, ...v3Base } = v3.body;
  assert.deepEqual(v3Base, v2.body, "v3 = v2 body + experiments, nothing else changes");
  assert.equal(v3.reads, 2, "the only added Worker cost: one extra KV read per v3 GET");
  assert.equal(v3.cache, "private, max-age=60");
  const parsed = interstitial.parseInterstitialV3Body(v3.body);
  assert.ok(parsed && parsed.experiment !== null);

  // An old Worker answers ?v=3 as legacy (five keys, rollout capped at 50, no optional keys): still a valid base on a 0.57 client, experiments OFF.
  const asOldWorker = interstitial.parseInterstitialV3Body(legacy.body);
  assert.ok(asOldWorker);
  assert.equal(asOldWorker.experiment, null);
  assert.equal(asOldWorker.config.rewardedLifecycleV2, undefined, "the rewardedLifecycleV2 kill switch cannot reach a 0.57 client through an old Worker");

  // Invalid or missing stored experiments never break the base.
  kv.store.set(interstitial.INTERSTITIAL_EXPERIMENTS_KV_KEY, "{not json");
  assert.equal((await get("?v=3")).body.experiments, undefined);
  kv.store.delete(interstitial.INTERSTITIAL_EXPERIMENTS_KV_KEY);
  assert.deepEqual((await get("?v=3")).body, v2.body);
});

test("L(8): the release's only new Worker path is the admin-gated PUT /api/config/ads/experiments; no client-reachable new route", async () => {
  const kv = new FakeKv();
  let assetCalls = 0;
  const ASSETS = {
    fetch: async () => {
      assetCalls++;
      return new Response("nf", { status: 404 });
    },
  };
  const env = { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: "t", ASSETS } as never;
  const put = (init: RequestInit) => worker.fetch(req("/api/config/ads/experiments", { method: "PUT", ...init }), env);
  assert.equal((await put({ body: JSON.stringify(EXPERIMENTS) })).status, 401);
  assert.equal((await put({ headers: { authorization: "Bearer wrong" }, body: JSON.stringify(EXPERIMENTS) })).status, 401);
  assert.equal((await put({ headers: { authorization: "Bearer t" }, body: JSON.stringify({ interstitial: { ...EXPERIMENTS.interstitial, cells: [{ id: "A", cadence: 5, cap: 3, weight: 100 }] } }) })).status, 400);
  assert.equal(kv.store.size, 0, "nothing stored until fully valid");
  const get = await worker.fetch(req("/api/config/ads/experiments"), env);
  assert.equal(get.status, 404, "no public GET for the experiments key");
  assert.equal(assetCalls, 1, "a GET is not handled by the Worker at all: it falls through to static assets");
  assert.equal(kv.gets.length, 0);
});
