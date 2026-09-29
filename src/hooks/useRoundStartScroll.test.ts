// Standing Mobile UX release gate, automated part: a newly started round must never begin
// outside the viewport. (1) The positioning rule itself. (2) Every gameplay mode wires it at
// round start, and the Android shell removes the prerendered page that made screens scrollable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type ScrollCall = { top: number; left: number; behavior: string };
const calls: ScrollCall[] = [];
let scrollY = 0;
(globalThis as Record<string, unknown>).window = {
  get scrollY() {
    return scrollY;
  },
  scrollTo: (o: ScrollCall) => void calls.push(o),
};
let rootTop = 0;
const root = { getBoundingClientRect: () => ({ top: rootTop }), closest: () => null };
(globalThis as Record<string, unknown>).document = { querySelector: (sel: string) => (sel === ".screen" ? root : null) };

const { scrollGameRootIntoView } = await import("./useRoundStartScroll.ts");

test("a round whose game root is above the viewport is brought to the top, instantly", () => {
  calls.length = 0;
  scrollY = 250;
  rootTop = -97; // measured on the Mi 8 before the fix
  scrollGameRootIntoView();
  assert.deepEqual(calls, [{ top: 153, left: 0, behavior: "instant" }]);
});

test("a round that already starts in view is never moved (no jump, no desktop effect)", () => {
  calls.length = 0;
  for (const top of [0, 12, 300]) {
    rootTop = top;
    scrollY = 40;
    scrollGameRootIntoView();
  }
  assert.equal(calls.length, 0);
});

test("never scrolls to a negative offset", () => {
  calls.length = 0;
  scrollY = 10;
  rootTop = -900;
  scrollGameRootIntoView();
  assert.equal(calls[0].top, 0);
});

const src = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");

test("every gameplay mode resets scroll at round/turn start", () => {
  const modes: [string, RegExp][] = [
    ["screens/ShapeChallengeScreen.tsx", /useRoundStartScroll\(phase === "preview"/],
    ["screens/SpecialChallengeScreen.tsx", /useRoundStartScroll\(phase === "intro" \|\| phase === "preview"/],
    ["screens/MegaChallengeScreen.tsx", /useRoundStartScroll\(phase === "preview"/],
    ["screens/DailyChallengeScreen.tsx", /useRoundStartScroll\(phase === "preview"/],
    ["screens/ArtistPackScreen.tsx", /useRoundStartScroll\(phase === "preview"/],
    ["screens/PlayChallengeScreen.tsx", /useRoundStartScroll\(phase === "preview" \|\| phase === "drawing"/],
    ["components/passplay/PassPlayGame.tsx", /useRoundStartScroll\(phase === "HANDOFF" \|\| phase === "COUNTDOWN" \? turnKey/],
    ["components/multiplayer/PlayTogetherRoom.tsx", /useRoundStartScroll\(phase === "COUNTDOWN" \|\| phase === "SHOW_SHAPE" \? roundIndex/],
  ];
  for (const [file, pattern] of modes) assert.match(src(file), pattern, `${file} must reset scroll when a round starts`);
});

test("the Android shell removes the prerendered crawlable block (no page under the app)", () => {
  assert.match(src("app/AppSkin.tsx"), /useCrawlableBlockTakeover\(\);/);
});

test("no global scroll reset in navigate(): long lists keep their position", () => {
  const app = src("App.tsx");
  const navigate = app.slice(app.indexOf("function navigate(next: Screen)"), app.indexOf("function enterGame("));
  assert.doesNotMatch(navigate, /scrollTo\(/);
});
