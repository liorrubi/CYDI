# Install Referrer Notes

Design for Android install attribution and first-install telemetry, prepared for the
release AFTER 0.49.2. Nothing here is implemented yet - this is the frozen
specification, written so the implementation session does not have to re-derive it.

Read this before touching `installReferrer.*`, the two new analytics events, or the
Install Referrer plugin.

## What problem this solves

CYDI has ~81 lifetime Play installs against 167 `installationId`s. Those are different
things and the gap is unexplained. `installationId` is a random number in localStorage;
it is NOT a Play installation and must never be reported as one. This feature adds the
one signal that can tell them apart, and answers where Play installs actually came
from.

Scope is strictly install attribution plus the defined `first_open` approximation.
**Install Referrer is not a channel classifier.** Do not use the presence or absence of
Play metadata to decide whether an install came from Google Play, and do not treat this
feature as resolving the APK-distribution question recorded in AGENT_NOTES.md. A
sideloaded APK on a device that previously carried a Play-distributed build of the same
package may still encounter retained Play-side install metadata (see QA / debug builds
below), so absence proves nothing and presence proves nothing. If a genuinely fresh
non-Play installation happens to return no usable Play metadata, that is an observed
case, not a rule.

## Verified API facts

All of the following were checked against the real artifact
(`com.android.installreferrer:installreferrer:2.2`, a 7,948-byte AAR from Google Maven,
decompiled with `javap`), NOT against the public reference page - which lists only four
methods and is out of date.

`ReferrerDetails` exposes seven public accessors:

| Method | Returns | Use |
| --- | --- | --- |
| `getInstallReferrer()` | `String` | parse, never store raw |
| `getInstallVersion()` | `String` | the load-bearing field |
| `getInstallBeginTimestampSeconds()` | `long` | age bucket only |
| `getReferrerClickTimestampSeconds()` | `long` | skip |
| `getReferrerClickTimestampServerSeconds()` | `long` | skip |
| `getInstallBeginTimestampServerSeconds()` | `long` | skip |
| `getGooglePlayInstantParam()` | `boolean` | skip - CYDI has no instant experience |

Behaviour the bytecode pins down, and that the plugin must honour:

- `getInstallVersion()` and `getInstallReferrer()` are plain `Bundle.getString` with no
  default, so both **return `null`** when the Play Store response omits the key. Older
  Play Store builds do exactly that. Null-guard both in Java.
- The timestamps are `Bundle.getLong` with no default, so an absent value is **`0`**,
  not null. "Absent" and "epoch 0" are indistinguishable - hence the `unknown` age
  bucket.
- `getInstallVersion()` is a real compile-time accessor. No AIDL, no raw Bundle access.
- The POM declares `<dependencies/>` - **zero transitive dependencies**.
- The AAR merges `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE`
  into our manifest. Normal protection level, no runtime prompt, but it will show up in
  the merged manifest and in Play's permissions view.

`InstallReferrerResponse` has **six** codes, not the three the docs page lists:
`OK`, `SERVICE_UNAVAILABLE`, `SERVICE_DISCONNECTED`, `FEATURE_NOT_SUPPORTED`,
`DEVELOPER_ERROR`, `PERMISSION_ERROR`.

Retention, quoted: "The install referrer information will be available for 90 days and
won't change unless the application is reinstalled."

## Architecture

A **minimal custom Capacitor plugin** wrapping Google's library. ~70 lines of Java in
the app module, no third-party npm package.

Why not native-only: `buildAnalyticsEnvelope` owns `installationId`, `sessionId`,
`isInternal`, `appVersion` and `appBuild`. Emitting from Java would mean reimplementing
all of it, including `shouldReportAsInternal()`. The plugin returns data; TypeScript
decides everything.

Why not a community plugin: four exist on npm, all small single-maintainer packages,
and the most active one bundles iOS AdServices we have no use for. For ~70 lines of
glue around a Google library that itself has zero dependencies, a third-party package
is more surface, not less.

Why this is safe across syncs: `cap sync` regenerates `assets/public`,
`capacitor.config.json` and plugin wiring - it does not touch our own classes under
`android/app/src/main/java/com/playcydi/cydi/`. `MainActivity.java` is currently an
empty `BridgeActivity`; registering one plugin is a two-line change.

**The parsing is free.** `resolveAttribution({ search, referrer, origin })` in
`src/services/analyticsAttribution.ts` is already a pure function over a query string,
and the Play referrer IS a query string:

    resolveAttribution({ search: referrerString, referrer: "", origin: "" })

That reuses the closed alphabet, the 32-char clipping, the cardinality guards and
`canonicalSource` - which already collapses `com.google.android.youtube` onto
`youtube`, exactly the form Play sends for an in-app YouTube referral. Do NOT invent an
Android-specific attribution structure; the existing five labels are correct.

## Event model

    install_attributed: Record<string, never>;
    first_open:         { installAge: InstallAgeParam };

    export const INSTALL_AGE_PARAMS = ["h0_24", "d1_7", "d7_30", "d30_plus", "unknown"] as const;

Attribution labels ride in the **envelope**, not in params. Both events join
`ATTRIBUTION_BREAKOUT_EVENTS`, which gives each of them `bySource` / `byCampaign` /
`byUtmContent`. `first_open`'s attribution maps are the number this feature exists to
produce: where genuinely new installs came from.

`buildAnalyticsEnvelope` currently omits `attribution` on native, deliberately - the
comment there already names the Install Referrer as the out-of-scope mechanism. It
gains an optional explicit attribution used ONLY by these two events. Every other
native event is unchanged and `bySource` stays a website measure everywhere else.

### first_open decision logic

Emit when **both** hold, and nothing else participates:

- no local `first_open` marker, and
- `installVersion === APP_VERSION`

A null `installVersion` (older Play Store) counts as **not matching**, so a null never
produces a `first_open`. That is the conservative direction and it is deliberate.

`installAge` is computed and reported but **takes no part in the decision**:

| bucket | condition |
| --- | --- |
| `h0_24` | age < 24 h |
| `d1_7` | 24 h <= age < 7 d |
| `d7_30` | 7 d <= age < 30 d |
| `d30_plus` | age >= 30 d |
| `unknown` | `installBeginTimestampSeconds === 0`, or a negative age (device clock moved backwards - the case `getSessionId` already guards for) |

`installAge` is a **diagnostic signal only**. Old-age buckets may suggest duplicate
behaviour in aggregate; they are not proof that any specific event came from
clear-data, and must never be read that way.

An earlier draft gated `first_open` on `installAge < 24h`. That was wrong and is
removed: it silently dropped genuine installs first opened days later, which on Play is
common (overnight auto-install, batch installs). A missed install biases the headline
number down and invisibly; a duplicate biases it up and is at least visible.

### The limitation, stated accurately

Exact once-per-install semantics are **not achievable with local state alone**. After
clear-data the device presents byte-identical Play state to a genuine first launch:
referrer, `installVersion` and `installBegin` are unchanged, and every local observable
is gone. So `first_open` may fire again after clear-data for as long as the original
`installVersion` still matches the running version. **Accepted trade-off.**

Describe the event as: *first launch observed for an installation whose original
installed version matches the running app version.* Never as "the first ever launch",
and never as an exact install counter. The name stays `first_open` - there is no
implementation reason to change it, and the schema comment carries the precision.

### Future exact-dedupe path (documented, NOT implemented)

Derive a server-side install key from Play install metadata, e.g.
`hash(installBeginTimestampSeconds + installVersion + referrer)`, and count each key at
most once in the DO. All three inputs are Play-side, unchanged by clear-data, and
contain nothing about the person. Collision risk is negligible at single-digit installs
per day.

The cost is why it is deferred: persistent per-install server storage, a new storage
shape, a retention policy and a cardinality cap - larger than the rest of this feature
combined.

**Never introduce device identifiers** - SSAID, App Set ID and Advertising ID are all
excluded. They would move CYDI from "no identifiers, random local numbers only" to
"collects device identifiers", contradicting the data-minimisation promise the privacy
policy makes.

## QA / debug builds

**If `isQaBuild()` / `Capacitor.DEBUG` is true, skip the Install Referrer flow
entirely.** Do not contact the service. Emit neither event.

This is not belt-and-braces, it is the actual protection. An earlier draft assumed a
sideloaded APK returns `FEATURE_NOT_SUPPORTED` - that is **wrong**. That code means the
installed Play Store app does not implement the service; it says nothing about how our
APK was installed. A sideloaded build on a device with a current Play Store connects
normally, and the Mi 8 has carried Play-distributed CYDI builds before, so it may
return **stale referrer and stale `installVersion` for the package**.

QA protection therefore rests on the validated build flag, never on Install Referrer
behaviour.

## Persistence and idempotency

One key, `cydi.installReferrer.v1`, holding `{ status, attempts, firstOpenEmitted }`.

Error policy across all six codes:

| Code | Action |
| --- | --- |
| `OK` | Parse. Null/empty referrer -> record "no data", emit no `install_attributed`. Mark done either way. |
| `SERVICE_UNAVAILABLE` | Transient - retry on a later launch, bounded to 3 attempts |
| `SERVICE_DISCONNECTED` | Transient - retry on a later launch, shares the counter |
| `FEATURE_NOT_SUPPORTED` | Play Store cannot serve it - mark done, no retry |
| `DEVELOPER_ERROR` | Our bug (e.g. reusing a finished client) - mark done, no retry |
| `PERMISSION_ERROR` | Merged permission missing - mark done, no retry |

## Migration and failure behaviour

The two events are independent decisions and must not be conflated, but they are not
independent of Play. **Both depend on fields obtained from the same Install Referrer
response** - they simply depend on different fields:

- `install_attributed` requires a usable **referrer string**
- `first_open` requires a usable **`installVersion`**

Neither event may invent missing Play metadata. Google documents `install_version` as
part of the Install Referrer response data, and documents that response as available
for 90 days, so the 90-day availability rule is not something only
`install_attributed` is subject to.

The distinction that matters is decision logic versus data availability:

- **Decision logic:** there is no `installAge < 90d` gate on `first_open`. If Play
  returns `installVersion === APP_VERSION`, no local marker exists and the other
  conditions hold, `first_open` may fire regardless of the calculated age bucket.
- **Data availability:** we make no claim that Play keeps returning `installVersion`
  past 90 days. If the metadata is unavailable or `installVersion` is null,
  `first_open` does not fire.

| Case | `install_attributed` | `first_open` |
| --- | --- | --- |
| Existing user upgrading | once, if referrer data is still available | **never** - `installVersion !== APP_VERSION` |
| Genuine new install, opened promptly | once | once, `installAge` `h0_24` |
| Genuine new install, first opened much later, response still available | once | once, in a later `installAge` bucket |
| First launch after the documented 90-day availability period | **no guaranteed measurement** | **no guaranteed measurement** - if Play still supplies a valid `installVersion`, normal logic applies; if it does not, nothing is emitted |
| `OK` but referrer string null/empty, `installVersion` present | no | yes |
| Response entirely unavailable (`FEATURE_NOT_SUPPORTED`, or no data at all) | no | **no** - `installVersion` is null, so the gate cannot pass |
| Reinstall | subject to the normal availability and validation rules | once |
| **Clear app data, still on the install version** | **can repeat** | **can repeat** - the accepted limitation |
| Clear app data after upgrading past the install version | can repeat | never |
| QA / debug build | never | never - flow skipped |

So `first_open` has no age gate in its decision logic, but it is still bounded by
whether Play returns a readable `installVersion` - which is part of the same response
and therefore subject to the same documented availability. Past 90 days the honest
answer is that measurement is not guaranteed in either direction.

On reinstall, state it narrowly: Install Referrer information does not change unless
the application is reinstalled; after a reinstall the returned information belongs to
the new installation and remains subject to the normal availability and validation
rules. Do not claim "Play resets the referrer".

Organic installs return a real value (`utm_source=google-play&utm_medium=organic`), not
an empty one, so "no campaign" stays distinguishable from "unattributable".

## Backend changes

Follow the existing `byReason` pattern in `worker/analyticsDO.ts` exactly.

| File | Change |
| --- | --- |
| `src/services/analyticsSchema.ts` | 2 event names; `INSTALL_AGE_PARAMS` + `isInstallAgeParam`; `validateNoParams` for `install_attributed`; exact-key validator for `first_open` |
| `worker/analyticsDO.ts` | `byInstallAge?: Record<string, number>` in `EventCounters`; `INSTALL_AGE_BREAKOUT_EVENTS = new Set(["first_open"])`; the increment guarded by `isInstallAgeParam`; 2 entries in `ATTRIBUTION_BREAKOUT_EVENTS` |

`byInstallAge` is bounded to five keys by the closed union, re-validated server-side
before it is reached - the same argument the `byReason` comment already makes.

**DEPLOYMENT ORDER - the `no_fill` trap, doubled.** Both an unknown event NAME and an
unknown `installAge` VALUE make `validateEventParams` fail, and the Worker drops the
whole event with HTTP 400. The Worker must know the two event names AND the five bucket
strings before any client sends them. A push to master deploys web + Worker together
and the AAB goes to Play afterwards, so the existing order handles it - but it has to
be deliberate.

## Files and dependencies

| File | Change |
| --- | --- |
| `android/variables.gradle` | `installReferrerVersion = '2.2'` |
| `android/app/build.gradle` | one `implementation` line |
| `android/app/src/main/java/com/playcydi/cydi/InstallReferrerPlugin.java` | **new**, ~70 lines |
| `android/app/src/main/java/com/playcydi/cydi/MainActivity.java` | `registerPlugin(...)` |
| `src/services/installReferrer.ts` | **new** - bridge, one-shot policy, first_open decision |
| `src/services/installReferrer.test.ts` | **new** |
| `src/services/analytics.ts` | optional explicit attribution on the two events |
| `src/services/analyticsSchema.ts` | see above |
| `src/App.tsx` | fire the one-shot on native startup |
| `worker/analyticsDO.ts` | see above |
| `src/content/privacyPolicyHtml.ts` | wording (see below) |

## Tests

Unit (plain Node, existing runner): referrer string -> `Attribution` for organic, a
tagged Short link, empty, null, and a hostile 4 KB string; the full `first_open`
decision table including null `installVersion`; every age bucket including `0` and a
negative age; idempotency across simulated restarts; bounded retry for each of the six
response codes; `isQaBuild()` true starts no flow and emits nothing; non-native
platform emits nothing.

Schema: both events validate; `first_open` rejects an unknown `installAge`;
`install_attributed` rejects any params; both are in `ATTRIBUTION_BREAKOUT_EVENTS` and
`first_open` is in `INSTALL_AGE_BREAKOUT_EVENTS`.

Worker: a native `first_open` envelope carrying attribution increments `bySource` and
`byInstallAge`; an unknown event name and an unknown bucket are both rejected.

### Device validation - Play Internal Testing, no debug bypass

The feature depends on Play-owned installation metadata, so authoritative end-to-end
validation happens through Google Play. **Do not add a debug FORCE override** to
approximate the environment - it would validate a bypass rather than the thing we ship,
and it would add a flag that must never be enabled in a real build. Scenarios B, C and
D therefore need release-signed builds on the internal testing track, and C needs two
successive uploads. Budget for that.

**These are independent scenarios, not one sequential run on one device.** Each needs
its own starting state: a persisted local marker left behind by an earlier scenario
would silently satisfy the next one's precondition and the test would prove nothing.
Use clean reinstalls, separate devices, or separate build sequences as needed.

**A. Sideloaded debug APK.** Assert the Install Referrer flow was not started, zero
`install_attributed`, zero `first_open`. No response-code expectation and no referrer
observation: the flow is skipped, so there is no response to observe.

**B. Fresh install.** Install the instrumented release from Play Internal Testing
through a tagged `&referrer=` link. Verify `install_attributed` once, `first_open`
once, correct attribution labels, an appropriate `installAge`, and that force-stop plus
relaunch emits neither again.

**C. Upgrade.** A separate clean scenario, and the one that actually proves the upgrade
guard:

1. install an older Play-distributed CYDI build that does NOT contain this feature or
   its local state
2. do not clear its data
3. update through Play to the new instrumented build

Verify that the Install Referrer metadata reports the ORIGINAL installed version, that
`install_attributed` follows the defined attribution rules, and that `first_open` is
**not** emitted because `installVersion !== APP_VERSION`.

Starting from a build that has no local marker is the whole point. Upgrading a device
that already ran the instrumented build would only prove that an existing marker
suppresses repetition, which is a different and much weaker claim.

**D. Clear-data.** Another fresh Play installation, where the running version is also
the original install version:

1. verify the initial `first_open`
2. clear application data
3. launch again WITHOUT upgrading

Verify that `first_open` can repeat and that its `installAge` reflects elapsed time.
Record as the accepted local-state limitation, not a regression.

Do not run D after C. Once the running version differs from the original install
version, `installVersion !== APP_VERSION` and the known duplicate case is no longer
reachable - the test would pass for the wrong reason.

## Privacy and compliance

**Privacy policy - change required.** The relevant paragraph opens "On the website, an
analytics event also carries a few short labels..." in
`src/content/privacyPolicyHtml.ts`. It must be extended to cover the Android app and to
say the labels come from Google Play at install time. The existing promise - short
labels only, never a full address - stays literally true, which keeps the edit small.

**Play Data Safety - probably no change, but UNVERIFIED.** No new data category: no
identifiers, no AD_ID, no location, and the install timestamp is used as a coarse age
bucket and discarded. The submitted Data Safety answers cannot be read from the repo,
so this must be checked against the live form before shipping rather than assumed.

**Consent - no change.** The Install Referrer is not personalised-advertising data and
is not gated by UMP. No new runtime permission.

## Risks and limitations

1. A true first_open **cannot be reconstructed for anyone who installed before this
   release.** `installVersion` correctly says they are not new, but the original
   first-launch moment is gone. The install baseline starts at this release.
2. Google documents the Install Referrer response as available for 90 days, so neither
   backfilled attribution nor a late `first_open` is guaranteed beyond that. Past it,
   assume nothing either way and read whatever arrives as a bonus.
3. **Release-day distortion.** Backfilled `install_attributed` events land in today's
   day-bucket even though the installs are weeks old. Day one will show a spike that is
   not installs. Read `first_open` for the daily number.
4. `installVersion` may be null on older Play Store clients; the design degrades to no
   `first_open` rather than to a guess.
5. Reinstalls inflate `first_open` above unique humans.
6. Clear-data can duplicate both events while the install version still matches.
7. Second-resolution timestamps mean the future dedupe key would collide at high
   volume. Not a concern at CYDI's scale, but it bounds that upgrade path.

## Recommendation

Ship as its own Android release after 0.49.2, isolated from any other product change -
it touches native code, the shared schema and the Worker at once, and that is enough
for one release. Deploy the Worker before the AAB.

It is a larger change than 0.49.2 was, and device test 4 needs two internal-track
uploads, so it should be planned rather than treated as a quick follow-up.
