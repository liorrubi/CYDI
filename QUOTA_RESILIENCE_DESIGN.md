# CYDI — resilience against Workers quota exhaustion

Design only. Nothing here is implemented. Branch `design/quota-resilience`, based on `55f7f9c`.

Target failure mode: **24 Sep 2026, 19:19–23:59 UTC.** Every Worker-invoking path returned
Cloudflare 429; paths excluded from `run_worker_first` kept serving 200/304 throughout.
Measured during the outage:

| | 200 | 304 | 429 |
|---|---|---|---|
| Worker-bypassing paths | 22 | 28 | **0** |
| Worker-invoking paths | 0 | 0 | **10,309** |

The asset layer never stopped. Only the Worker did. That is the lever.

## The number that decides the design

Worker-invoking requests, 24 Sep (80,113 of 83,176 total):

| class | requests | share |
|---|---|---|
| `/api/analytics/*` | 57,753 | 72.1% |
| `/api/room*` | 12,112 | 15.1% |
| `/api/config/*` | 3,423 | 4.3% |
| `/api/daily/*` | 3,387 | 4.2% |
| `/api/content/*` | 2,665 | 3.3% |
| SPA fallback (`/join/*`, bots) | 439 | 0.5% |
| **SEO landing pages** | **169** | **0.21%** |
| robots/sitemap | 57 | 0.07% |
| **content pages** | **53** | **0.07%** |
| `/s/*` campaign | 28 | 0.03% |
| `/api/share*` | 18 | 0.02% |
| `/android` | 5 | 0.01% |

23 Sep is the same shape (analytics 84,133 of 98,783).

**Every public page on the site, combined, is 0.4% of Worker invocations.**
Making them static saves ~310 requests/day out of 80,113.

So: **this work buys availability, not quota.** It is still worth doing — during the
outage a cold visit to `/` was dead, and it did not need to be — but it must not be
sold as a quota fix. The quota fix is analytics volume (72%), which is a different
project and is partly addressed by the 10% sampling already live.

## Route classification

### A — must invoke the Worker

| route | why |
|---|---|
| `/api/analytics/event`, `/events` | POST ingest, shed decision, AnalyticsDO forward |
| `/api/analytics/report` | admin, AnalyticsDO |
| `/api/room` (POST) | cost guard + RoomDO allocation |
| `/api/room/:code/ws`, `/info` | WebSocket upgrade into RoomDO |
| `/api/daily/*` | DailyChallengeDO |
| `/api/share` (POST), `/api/share/:id`, `/api/share/:id/image.png` | SHARE_KV + runtime PNG |
| `/api/content/catalog`, `/activate`, `/releases` | CONTENT_KV, admin-mutable |
| `/api/config/*` (ads, interstitial, guards, breaker) | CONTENT_KV; mutation paths are admin |
| `/c/:code` | per-share OG metadata from KV |

**These must never fail open.** Multiplayer, admin, and every config/analytics mutation
endpoint should return an error rather than a stale or permissive static answer. A
statically-served "multiplayer guard" would be a guard that cannot be turned on.

### B — can bypass the Worker as a true static asset

| route | today | note |
|---|---|---|
| `/` | Worker: shell + HTMLRewriter head | fully deterministic at build time |
| 16 SEO landing paths (`/draw-shapes-online`, `/drawing-challenges`, `/draw-a-perfect-circle`, …) | same | same |
| 6 content pages (`/how-to-play`, `/about`, `/contact`, `/terms`, `/privacy`, `/accessibility`) | Worker: `renderContentDocument` | whole documents, generated from code |
| `/robots.txt`, `/sitemap.xml` | Worker: `textResponse` | derived from `CONTENT_PATHS` |
| SPA fallback (`/join/:code`, unknown paths) | Worker → `env.ASSETS.fetch` | already just the shell |
| `/assets/*`, `/images/*`, `/admin/*`, `/.well-known/*`, `/favicon.svg`, `/app-ads.txt` | **already bypassing** | unchanged |

Every page in this table is a pure function of committed source (`seoPages.ts`,
`contentPages.ts`) plus the built shell. Nothing reads KV or a DO. They are
prerenderable with no loss of fidelity.

### C — Worker only for redirect/config logic; redesignable

| route | today | alternative |
|---|---|---|
| `/s/:slug` | 302 from `campaignLinks.ts` static map | zone Redirect Rule / Bulk Redirect |
| `/android` | 301 to the Play listing | zone Redirect Rule |
| `/api/config/ads` | KV read, `max-age=60` | edge cache — but see caveat below |
| `/api/content/catalog` | KV read, `max-age=300` | edge cache — same caveat |

**Caveat on edge-caching the config endpoints.** They are not currently cached
(`cf-cache-status` absent on both). A Cache Rule could cache the *response*, but with
`run_worker_first: ["/*"]` the Worker is still invoked, so it would not reduce Worker
requests — and it would not survive a 429 either. Making them genuinely Worker-free
means emitting them as build-time static files, which destroys the property they exist
for: changing ads/catalog config without a deploy. **Recommendation: leave them on the
Worker.** The 6,088/day they cost is real but it buys the remote kill switch.

## Proposed architecture

**Prerender class B into `dist/` at build time, then exclude those paths from
`run_worker_first`.** That is the whole idea. It uses the mechanism that demonstrably
survived the outage, and adds no new runtime dependency.

```
build:
  vite build                    -> dist/ (shell + assets, as today)
  node scripts/prerenderPages.ts -> dist/index.html              (home, SEO head applied)
                                   dist/draw-shapes-online/index.html
                                   dist/drawing-challenges/index.html
                                   ... 16 SEO paths
                                   dist/how-to-play/index.html
                                   ... 6 content pages
                                   dist/robots.txt
                                   dist/sitemap.xml
```

The prerender script imports the *same* `seoPages.ts` / `contentPages.ts` modules the
Worker uses and applies the *same* head rewrite, so there is one source of truth and
the output cannot drift from what the Worker would have produced.

### Why not `fail_open`

There is no fail-open available for this deployment. `playcydi.com` is a **Workers
Custom Domain** (`/workers/domains`), and the zone's `workers/routes` list is empty.
`fail_open` is a Workers *Route* concept and is not offered for Custom Domains, so
there is no toggle that makes a Worker-routed path fall back to assets when the
runtime refuses the request. The 24 Sep data confirms it empirically: every
Worker-routed path 429'd with no asset fallback.

**The exclusion list is the only mechanism that actually works here.**

## Exact changes required

1. **`scripts/prerenderPages.ts`** (new). Reads `dist/index.html`, applies the same
   transform as `handleSeoPage`, writes one file per SEO path; renders each content
   page via `renderContentDocument`; writes `robots.txt` and `sitemap.xml`. Follows
   the existing `scripts/*.ts` + `register-ts.mjs` pattern.
2. **`package.json`** — `"build": "tsc -b && vite build && npm run prerender"`.
3. **`wrangler.jsonc`** — extend the `run_worker_first` exclusions with the generated
   paths. Generated from the same arrays, so a new SEO page cannot be forgotten.
4. **`worker/index.ts`** — keep the existing handlers untouched as the fallback path.
   They stop receiving traffic but remain correct, so a mistake in the exclusion list
   degrades to today's behaviour rather than a 404.
5. **Tests** — assert prerendered output is byte-identical to what the Worker produces
   for the same path. That is the guard against drift, and it is the one test that
   matters.

Phase 2 (optional): move `/s/*` and `/android` to zone Redirect Rules.
Phase 3 (optional): a service worker caching the shell — the app currently has none,
so a returning visitor has no offline path at all.

## Risks

**SPA routing.** Cloudflare's asset server resolves `/draw-shapes-online` to
`/draw-shapes-online/index.html` under its default `html_handling`. This must be
verified in preview before rollout — get it wrong and a landing page 404s instead of
falling back to the shell. Highest-risk item.

**Attribution.** `/s/:slug` attaches campaign params server-side. If moved to Redirect
Rules (phase 2), the rules must reproduce `campaignLinks.ts` exactly or attribution
silently changes. Phase 1 does not touch this.

**SEO.** Prerendering is neutral-to-positive: the same head, the same appended copy
block, now served without a Worker dependency. Canonicals must be generated identically
— the byte-identity test covers this. One genuine change: content pages are currently
`max-age=600` because "the scoring example and the shape counts are computed from the
live code at render time"; prerendering freezes them per deploy. That is correct only
if those counts come from the baked-in library and not the live catalog — **verify
before implementing**, because the catalog can change without a deploy.

**Analytics.** Unaffected. Attribution and event emission are client-side; the shell is
identical either way.

**Fallback semantics.** A path in the exclusion list that has no prerendered file falls
to `not_found_handling: single-page-application` — the bare shell, no SEO head. Wrong
head, not an outage, and caught by the drift test.

## How to test quota-failure behaviour safely

Do not attempt to exhaust the quota. The property to test is *routing*, not throttling:

1. **Prove the path does not invoke the Worker.** Request it, then query
   `workersInvocationsAdaptive` for that minute and confirm no corresponding
   invocation. This is exactly how the 24 Sep bypass was confirmed, and it is the
   property that matters — if the Worker is not invoked, quota cannot take the path
   down.
2. **Prove content fidelity.** Byte-compare prerendered output against the Worker's
   current response for every path in class B, in CI.
3. **Simulate the failure locally.** `wrangler dev` with the fetch handler forced to
   throw or return 429, then confirm the class-B paths still serve.
4. **Watch `cf-cache-status` and `x-robots-tag`** on `/c/:code` and the SEO paths after
   rollout — a header regression is the likeliest silent breakage.

## Phases

| phase | scope | value |
|---|---|---|
| **1** | Prerender class B + exclusion list | Site and Classic survive a Worker outage. ~0.4% quota. |
| **2** | `/s/*`, `/android` → Redirect Rules | Install and campaign links survive. ~0.03% quota. |
| **3** | Service worker for the shell | Returning visitors survive a total zone failure. |
| **4** | Client degradation review | Already largely true — see below. |

## Classic already survives API failure

Verified in source; no change needed:

- `contentRepository.ts` — the baked-in local catalog is the default source *and* the
  permanent offline fallback.
- `analyticsQueue.ts` — a failed batch is dropped and never propagates.
- `remoteKillSwitch.ts` — any non-2xx leaves `FAIL_CLOSED`; ads simply do not serve.
- Progress lives in `localStorage`, not on the server.

**The only thing standing between a Worker outage and a playable Classic game is that
`/` itself invokes the Worker.** Phase 1 removes that, and nothing else is required.
