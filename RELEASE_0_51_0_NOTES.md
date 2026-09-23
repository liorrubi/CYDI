# CYDI 0.51.0 / versionCode 44 — the Cloudflare cost release

Prepared 23 Sep 2026. **Not deployed, not published.** This file is the deployment
order and the validation sequence; read it before shipping any part of this release.

## Why this release exists

On 23 Sep 2026 CYDI exhausted two account-wide Cloudflare Free-plan Durable Object
limits in one day and production went to edge `429`:

| | Measured | Cap |
|---|---|---|
| DO requests | 111.12k | 100k |
| DO SQL rows written | 120.99k | 100k |
| Workers requests | 60.9k | 100k — never the problem |

Server-side work (`33ae4a1`, deployed) cut rows written by ~89%. It could not touch
DO **requests**, because both sources of those live in the client:

- analytics posted one HTTP request per event — ~48.85k DO requests/day;
- Play Together sent a timestamped clock ping every 10 s purely to keep its offset
  fresh, and every one woke RoomDO — ~60% of its 56.45k.

0.51.0 is the client half.

## What is in it

**A4 — analytics batching.** Events are queued and posted in batches of up to 10, or
after 15 s, or on a lifecycle transition, to a new `POST /api/analytics/events`.
Deliberately not retried: the endpoint has no idempotency key, so a re-sent batch
whose response was lost would double-count, and a silently doubled counter is worse
than a missing one. A failed batch is dropped, exactly as a failed single event
already was — which also makes a retry storm impossible.

**B1 — liveness split from clock sync.** Staying connected is now proved by a fixed
frame (`{"type":"lp"}`) that the Cloudflare runtime answers itself via
`setWebSocketAutoResponse`, without waking RoomDO. Clock sync keeps the existing
timestamped `ping` — its reply must carry a server clock — but the client sends it as
a burst of four samples at connect plus two after a resume from >60 s hidden, instead
of every 10 s forever. `bestRtt` keeps only the lowest-latency sample ever seen, so
accuracy stops improving after a handful and the permanent cadence was buying nothing.

**Ads — NOT in this release.** See "Ads status" below.

## DEPLOYMENT ORDER — stricter than usual

1. **Worker first.** `/api/analytics/events` does not exist on the deployed Worker. A
   client that reaches users before the Worker ships posts every batch into a 404 and
   loses **all** of its analytics — not degrades, loses.
2. Confirm the batch endpoint answers 200 in production.
3. Only then distribute the Android build.

The Worker half is backward compatible on its own and can ship independently:
`/api/analytics/event` is unchanged, and the `lp` frame is additive.

## Backward compatibility

Every already-installed APK keeps working unchanged, and this is covered by tests
rather than assumed:

- `/api/analytics/event` is kept **indefinitely** and its responses are byte-identical.
- Old clients keep sending `{"type":"ping","clientSentAt":…}` on their 10 s cadence
  and keep getting `pong` with `serverNow`.
- Old and new clients can sit in the same room; a mixed-version game is tested.
- If `setWebSocketAutoResponse` is ever unavailable, `lp` falls through to a handled
  no-op reply in `webSocketMessage` — it must never read as `bad_frame`.

## Post-reset validation sequence

Run in this order once the UTC-midnight quota reset clears the 429.

1. **Confirm deployed P0 is healthy.** `/`, `/api/config/ads`, `/android`, `/s/test`
   return 200/200/301/302. `/api/analytics/report` and `/api/daily/current` answer
   instead of 1101. Deployed version is `af2d6253` (= `33ae4a1`).
2. **Record the baseline** before any new deploy: DO requests, rows written, rows
   read, Workers requests, and RoomDO requests ÷ multiplayer games for the first
   clean hours of the day.
3. **Deploy the Worker half** of 0.51.0. Re-probe the four routes. Confirm
   `POST /api/analytics/events` returns `{"ok":true,"accepted":N,"rejected":0}` and
   that `POST /api/analytics/event` still returns `{"ok":true}`.
4. **Install the APK** on the Mi 8 (see the signature note below) and exercise:
   several single-player rounds, one Play Together game, background/resume.
5. **Measure**, from the Cloudflare dashboard:
   - Workers requests/day
   - AnalyticsDO requests/day
   - RoomDO requests/day
   - SQL rows written/day
   - RoomDO requests per representative multiplayer game
6. **Compare with the 23 Sep baseline** and against the model below.
7. **Decide** whether to publish 0.51.0 to Play.

### What "success" looks like

Modelled, at a 23-Sep-sized workload (~50k analytics events, 489 multiplayer games):

| | 23 Sep actual | Server-only P0 | Modelled after 0.51.0 |
|---|---|---|---|
| DO requests | 111.12k | ~109k | **~37–40k** |
| Rows written | 120.99k | ~33k | ~22k |
| Workers requests | 60.9k | ~60k | ~15k |

**None of this is measured.** The A4 number follows from batching 10 events per
request; the B1 number assumes auto-response is not billed as a DO request, which
cannot be proven from local workerd. If the B1 saving does not appear in production,
the fallback is to raise the liveness interval (15 s → 30 s or more), which is a
one-constant client change — it reduces wakes proportionally even when every frame
does wake the object.

### Device note

The Mi 8 currently runs the **Play-signed** 0.50.0. A debug-signed APK cannot install
over it: the device needs a manual uninstall first, which wipes localStorage
(progress, coins, the installation id, the internal-device flag). Re-set the 7-tap
internal toggle afterwards if QA events should stay out of the real numbers.

## Ads status — deliberately not in this release

The interstitial experiment (every ~7 completed eligible games, 5% canary, remote
rollout/cadence/cap/country control, stable installation bucketing, show-if-ready)
was fully designed and frozen across three PREPARE rounds, but **was never written to
the repository** and is not implemented here. Three reasons it is not in 0.51.0:

1. **It cannot serve an ad.** No AdMob interstitial unit exists yet, and creating one
   was explicitly deferred. Without `VITE_ADMOB_INTERSTITIAL_ANDROID`, `getAdUnitId()`
   returns `""` and the format is skipped — the build would be ad-*capable* and inert.
2. **It needs its own Worker deploy first** (new event names, and a separate
   `/api/config/ads/interstitial` endpoint — the existing `/api/config/ads` validator
   is strict `{ enabled }` only, so extending it would turn rewarded ads off on every
   installed device).
3. **It would confound this release's measurement.** 0.51.0 exists to produce one
   number: whether A4+B1 move a 23-Sep workload from ~109k DO requests to ~37–40k.
   Interstitials add new analytics events and a per-preload config fetch, changing the
   very quantity being measured.

Worth noting what bundling would *not* have broken: the interstitial A/B comparison
itself, since control and treatment are randomised **within** a release and both arms
would carry A4+B1 equally. Only the absolute before/after baseline is confounded.

Recommendation: ship 0.51.0, bank the measurement, then ship ads as 0.52.0 with the
AdMob unit created and the Worker half deployed first.
