# Agent Workflow Notes

Efficiency rules for working in this repo (token budget matters to the user).

- Don't re-read a file with the Read tool if it was already read/checked earlier in the
  same session and hasn't changed since. Trust prior context.
- Don't explain each change in detailed prose. Report changes tersely (a short list of
  what changed, not a paragraph per change).
- Don't verify (build/browser render) after every individual change - see
  `SHAPE_DESIGN_NOTES.md` for the shape-specific version of this rule. Only verify when
  asked, or once several changes have accumulated and the user approves a check.

## Quick Fix mode - small design/UI requests

When the user asks for a small visual/design change or a point UI fix (e.g. "move this
icon to the other side," "make this text smaller," "change this color"), treat it as a
**Quick Fix**, not a feature task:

- Make only the minimal change needed. Don't refactor, don't touch logic, don't make
  general improvements, and don't change files beyond the ones that must change for this
  specific fix.
- After making the change, do only a basic check that the relevant screen loads and the
  change is visible (e.g. one screenshot or snapshot) - then stop. Don't run a full
  verification pass, don't test unrelated flows, don't check edge cases.
- Report back briefly: what changed, and in which file(s). No long explanation of
  reasoning.

## Shape lock/unlock logic - where to look

When asked to lock or unlock the shapes (e.g. "unlock all shapes so I can browse them" or
"revert the lock back to normal"), the relevant code is in
`src/screens/ShapeChallengeScreen.tsx`, inside the `ShapeMap` component, in the
`shapes.map((shape, index) => { ... })` block:

- Normal/correct behavior:
  `const unlocked = unlockAllOverride || isShapeUnlockedAt(progress, category, shapes, index);`
  (progressive unlock - a shape is playable once completed, or when it's the current
  frontier: the first not-yet-completed shape in the category).
- To temporarily unlock everything for browsing: replace that line with
  `const unlocked = true;` and leave a `// TEMP: ...` comment so it's easy to find and
  revert later.
- The unlock rule lives in `src/services/shapeChallengeProgress.ts`
  (`isShapeUnlockedAt` / `getFrontierIndex`, id-based) - don't touch that when toggling
  the lock bypass; only the `unlocked` line itself needs to change.

## Analytics: the 22-23 Sep 2026 Android spike

**Not QA noise.** The 22-23 Sep Android spike should no longer be treated as likely QA
contamination. Direct Cloudflare path-level evidence shows substantial real native-Android
traffic originating from Iran, and independent app endpoints show the same country pattern.
**The exact number of games attributable to Iran cannot be reconstructed, because
`country x game_started` is not stored anywhere.**

### 23 Sep 2026: direct Cloudflare evidence of substantial native Android traffic from Iran

Cloudflare GraphQL `httpRequestsAdaptiveGroups`, filtered to the exact path
`/api/analytics/event` (the ingest endpoint every analytics event is POSTed to), last 24h -
18,822 sampled/estimated requests:

| Country | Requests | Share |
|---|---|---|
| Iran | 10,148 | 53.9% |
| Azerbaijan | 2,586 | 13.7% |
| Germany | 1,668 | 8.9% |
| USA | 1,127 | 6.0% |
| Netherlands | 1,040 | 5.5% |
| Afghanistan | 541 | 2.9% |
| UK | 446 | 2.4% |
| Poland | 300 | 1.6% |
| Hong Kong | 220 | 1.2% |
| Tajikistan | 73 | 0.4% |
| Israel | 60 | 0.3% |

Iran's share on the analytics endpoint (53.9%) is **higher** than its zone-wide share
(~45.9%) - the zone figure is diluted by website and asset traffic that is not Iranian.

**Independent confirmation on other app endpoints.** Iran led every app-specific endpoint:
`/api/config/ads` 189 / 437, `/api/room` 88 / 201, `/api/daily/current` 17 / 53,
`/api/daily/submit` 16 / 48. By contrast the homepage `/` was led by the USA and Israel,
and Iran did not dominate it - so this is not website browsing.

**Native Android, not browser.** For Iran-originating requests to `/api/analytics/event`,
nearly all used native Android `Dalvik/2.1.0` user agents; only ~85 of ~10,148 came from a
browser UA. There were **124 distinct user-agent strings**, covering many Redmi/POCO and
Samsung Galaxy models and builds. **That is diversity of Android models/builds - it is NOT
a count of unique physical devices** and must never be quoted as one.

**Timing matches.** Iran-originating analytics traffic follows a human daily cycle in
Iranian local time: a strong evening peak, low overnight traffic, and a renewed morning
rise. That timing aligned with the observed Android gameplay acceleration.

Supporting signals from other sources: AdMob independently recorded rewarded-ad requests
from Iran on Android; the live Daily Challenge leaderboard carried a Persian-language
player name inside the same activity window; score and pass-rate distributions match real
human play; and the QA device is now independently classified `internal` while external
Android activity kept rising.

**Limits - do not overstate this:**

- The data is `country x HTTP request to the ingest endpoint`, **not**
  `country x game_started`. That intersection is not stored and cannot be reconstructed.
- `httpRequestsAdaptiveGroups` is a **sampled** dataset; the counts are scaled estimates.
- "Country" is the connection's egress country. A VPN reports its exit country.
- **Distribution channel is still unknown.** Public third-party distribution does exist -
  APKPure hosts CYDI 0.48.4/vc41 and APKCombo an older 0.35.1 - and the APKPure artifact was
  verified authentic and Play-signed (signer SHA-256 matches this app's Play app signing
  key, plus a Google Play source stamp). That makes non-Play distribution a **plausible**
  explanation for the Play-Console-versus-analytics gap, but there is **no direct evidence**
  that APKPure, APKCombo or any specific mirror is the acquisition source for the Iran
  traffic. **Do not write that the traffic "came from APKPure".**
- Do **not** infer that the USA / Germany / Netherlands traffic is Iranian VPN traffic.
  There is no direct evidence for that.
- **Play installs and `installationId` are not the same thing.** Play Console counts
  Play-distributed installs only. `installationId` is an app-local analytics identifier.
  An APK installed outside Play produces completely normal CYDI analytics, including its own
  `installationId`, without ever appearing in a Play install count.

**Ad monetisation note.** Iran currently contributes a large share of native Android
traffic, and AdMob has independently shown rewarded-ad requests from Iran. Country-level ad
availability / match rate / impression performance should therefore be evaluated **after**
the 0.49.2 preload release. Do **not** claim the current near-zero revenue is caused by Iran
alone - that has not been established.

Volume for the day: 431 external `game_started` on Android, against a prior baseline of
0-17 per day.

A read-only investigation had already ruled out the two QA explanations:

- **Not the known QA device.** `dumpsys usagestats` puts CYDI in the foreground for under
  8 minutes before the 08:52 cutover (08:44:15-08:52:31 plus three sub-second resumes).
  A round cannot complete faster than roughly 4s (2s preview + 0.8-1.2s analysing +
  drawing), so that window tops out near 120 rounds - it cannot produce 431. The device
  also carries a *debug* build installed at 08:43:49 via `packageinstaller` (sideloaded,
  not Play), and that build reports JS `APP_VERSION 0.49.1`, which accounts for exactly
  **1** external regular game. No local *release* APK of 0.48.4 was built or installed.
- **Not Google Play automation.** Play Console -> Pre-launch report shows the empty state
  ("Upload artifacts to generate pre-launch reports"). No pre-launch/Robo run has ever
  executed for this app, so there is no Play automation that could have produced traffic.

The stored dimensions still cannot reconstruct an exact genuine-user count.

**08:52 is not the end of proven contamination.** It is only the moment the new
debug-build internal classification was empirically verified on the device.

### 22 Sep 2026

Android activity was **highly anomalous and the source is not fully resolved**: 1,280
external regular-game starts and 185 distinct Android installationIds, against 81 lifetime
Play installs. The Iran evidence above is from the 23 Sep window and **is not carried back
to this day** - nothing available specifically covers 22 Sep.

A QA contribution remains **possible**: `usagestats` on the device only retains back to
22 Sep 18:45, so device usage earlier that day cannot be reconstructed either way. The
recorded evening windows total 29 minutes, which is far too little on its own.

Do not classify the whole day as proven QA contamination.

### Two earlier arguments that turned out to be invalid

Both were used to call these days contaminated; neither survives:

- **Historical Daily Challenges are NOT proof of automation.** `DailyChallengeScreen.tsx`
  has a replay mode (`Challenge from ${episode.dateKey}`) and the Durable Object keeps an
  episode `history`, so real players can play past challenges. `daily:40` / `daily:42`
  prove nothing.
- **The geometry-heavy shape mix is NOT proof of a catalog scan.** Geometric is the
  default category and `circle` its first shape, so a decaying distribution led by
  `circle` is exactly what ordinary progression produces.

The score distribution argues the same way: 2.61 average with a 57-60% pass rate across
1,563 rounds on 22-23 Sep is a spread of many hands, not the repeatable output of a
script.

### Baseline

**21 Sep 2026 is the last low-volume pre-spike day**, useful as a conservative comparison
point. It is **not** evidence that 22-23 Sep are invalid.

### What is settled

- Web data for 22-23 Sep is unaffected and usable.
- The debug-build fix in commit `8042949` is correct and **must not be reverted**: the
  envelope sends `shouldReportAsInternal() = isQaBuild() || isInternalDevice()`, and
  `isQaBuild()` reads `window.Capacitor.DEBUG` from the APK's own `android:debuggable`,
  which no reinstall or data clear can lose. It closes a real hole regardless of what
  caused these two days.
- Keep `cydi.analyticsInternal.v1 = "1"` set on the QA device as well - it is the only
  protection when testing a locally built *release* APK, where `Capacitor.DEBUG` is false.
- A QA debug APK reports `APP_VERSION` from `src/app/constants.ts`, which drifts ahead of
  the APK's Gradle `versionName` whenever build.gradle is deliberately not bumped.
- The stored day buckets were deliberately left untouched: they hold running totals, not
  per-event records, and `alltime` is a separate counter that deleting a day would not
  correct.

## Analytics: Pass & Play round breakdowns (since 22d59b5, 23 Sep 2026)

**Why this exists.** Pass & Play went from almost nothing to 177 starts in a week and
only 27 of those games finished. The completion rate was unusable because nothing said
which game LENGTH it belonged to - the events carried `roundCount`/`roundIndex` all
along, but the Worker validated them and threw them away.

### What is retained now

| Event | `byRoundCount` | `byRoundIndex` |
|---|---|---|
| `pp_game_started` | yes | - |
| `pp_game_finished` | yes | - |
| `pp_abandoned` | yes | yes |
| `pp_round_completed` | **no** | yes |

`pp_round_completed` carries no `roundCount` in the client event, so it deliberately gets
one map and not the other. **Do not add the other one by guessing the length** - a test
pins this asymmetry.

Domains are closed and already re-validated by `validateEventParams` before the Worker
sees them: `roundCount` is `ROUND_COUNT_OPTIONS` (5/10/15, three keys) and `roundIndex`
is `0..MAX_ROUND_INDEX`, derived as `Math.max(...ROUND_COUNT_OPTIONS) - 1` so adding a
new length cannot silently overflow the map. Both are in `mergeCounters`, so weekly,
range and alltime keep what the daily report shows.

Worker-only: every shipped client already sends these params (an event missing them is
rejected outright), so no APK was needed and collection started immediately.

### How to read them - the important caveat

**`pp_abandoned` is NOT the drop-out curve.** It fires only from the explicit "Quit
game?" confirmation in `PassPlayScreen.confirmQuit()`. Closing the app, the system Back
button and a screen lock emit nothing. In the week to 23 Sep: 177 started, 27 finished,
49 quit explicitly - **101 games simply stopped and are in none of those numbers**.

`pp_round_completed.byRoundIndex` is the one that answers the real question: it counts
how many games reached round 2, 3, 4... including everyone who vanished silently. Read it
as a survival curve; read `pp_abandoned.byRoundIndex` as a floor on deliberate quitting.

### What it is for

The current default is **10 rounds** (`PassPlayScreen.tsx`, `useState<RoundCount>(10)`) -
**unchanged, deliberately**. Two players draw sequentially, so 10 rounds is ~20 turns at
roughly 26s of forced time each (3s countdown + 3s shape + 20s drawing) plus handoffs:
~10-12 minutes on one shared phone with each player idle for half of it. Play Together
draws simultaneously, so the same 10 rounds is half the wall clock - and it completes at
76% against Pass & Play's 15%. **"10 rounds is too long" is the leading hypothesis, not a
proven cause.**

The telemetry shipped FIRST on purpose: it builds a real baseline of behaviour at the
current default before that default is changed, so the comparison afterwards is against
measured behaviour rather than a guess.

When the default does change, the decisive comparison is 5 vs 10 **inside the same time
window** via `byRoundCount` - same audience, same hour, same devices. Supporting the
hypothesis: 5-round games complete markedly better, and `byRoundIndex` on 10-round games
clusters early. Weakening it: similar completion at both lengths, or drop-out spread
evenly across indexes. Rematch rate is the sanity check - shorter games that people
choose to play again is stronger evidence than completion alone.

## Analytics: rewarded-ad country diagnostics (since df0c288, 23 Sep 2026)

**Why this exists.** Rewarded ads fail constantly - 1,092 `rewarded_ad_unavailable` against 26
`rewarded_ad_loaded` in one day - and nothing said whether that was one country behaving badly
or everyone. The QA phone loads an ad in 2.7s with no error and AdMob reports 100% fill, so the
failure is population-specific and invisible from here.

### Where country comes from

Resolved at the Worker ingress in `forwardToAnalyticsDO` (`worker/index.ts`) from
`request.cf?.country`, then passed to the Durable Object in the internal header
`x-cydi-country`. It has to work that way: `request.cf` exists only on the inbound edge
request and **does not survive a `stub.fetch`** into a DO.

**The client sends nothing and cannot spoof it** - the header is overwritten on every request
and the DO re-normalizes whatever arrives. **No new APK was needed**; this measures the clients
already in the field.

`normalizeCountry()` keeps a two-letter code uppercased and turns everything else - missing,
Cloudflare's `XX` and `T1`, and anything malformed - into `ZZ`. Only the code is stored: no IP,
city, region, coordinates or ASN is read, forwarded or kept.

### What is retained

| Event | `byCountry` | `byCountryReason` |
|---|---|---|
| `rewarded_ad_unavailable` | yes | yes |
| `rewarded_ad_loaded` | yes | - |
| `reward_offer_shown` | yes | - |
| `reward_bonus_offer_shown` | yes | - |

`byCountryReason` pairs the country with the existing closed `AD_FAILURE_REASONS` union -
`IR|timeout`, `DE|sdk_error`. Country alone says WHERE and reason alone says WHAT; only the pair
says whether Iran times out while Germany errors. It is capped at 150 keys, overflowing to a
dedicated **`OTHER`**.

**`ZZ` and `OTHER` are not interchangeable.** `ZZ` means the country could not be determined;
`OTHER` means the map hit its cardinality cap. A test pins that overflow never lands in `ZZ`.

### The two offer events are the DENOMINATOR - use them

`reward_offer_shown` and `reward_bonus_offer_shown` carry `byCountry` for one reason: **raw
failure counts are not a failure rate.** The country with the most players will always produce
the most failures. Always compare failures against offers from the same country in the same
window.

This is a country-level behavioural denominator built from existing events - **not** a physical
SDK load success rate. It also cannot be one: a successful preload makes every later preload in
the round a no-op, so one round emits a single `loaded` while a failing round emits several
`unavailable`. Failures are structurally over-counted relative to successes.

### How to word it

> Country inferred from the network request as seen by Cloudflare; this may reflect VPN/proxy
> exit country rather than the user's physical location.

Never report a country figure without that caveat, and never quote raw failure counts as a rate.

### Privacy and Play

The privacy policy was updated **in the same commit** - it previously stated CYDI's analytics
collects no location at all, which stopped being true the moment this deployed. Live at
`/privacy`.

**Google Play Data safety needed no change**, verified in the console on 23 Sep 2026:
`Location -> Approximate location` was already declared **collected**, **not processed
ephemerally**, **required (users can't turn it off)**, with **Analytics** among the purposes -
all four already correct for this. `Shared` is also ticked, which is true of the app as a whole
because of AdMob; our aggregation adds only to the collected side. Do not "tidy" those purposes:
`Advertising or marketing` and `Fraud prevention, security and compliance` are AdMob's, not ours.

### First data

Within minutes of deploy: `rewarded_ad_unavailable.byCountry {IR: 3}`,
`byCountryReason {IR|timeout: 3}`, and `reward_bonus_offer_shown.byCountry {DE: 6}` with no
German failures in the same window. Suggestive only - three events against 1,309 failures that
day, and the counters only start at deploy. Give it hours before reading anything into the ratio.
