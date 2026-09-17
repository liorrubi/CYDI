/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The DOM half of attribution: read the landing URL and referrer exactly once, pin
// the result to the current analytics session, and hand the same five labels to every
// event of that visit. The normalization itself is in analyticsAttribution.ts, which
// stays DOM-free because the Worker imports it too.
//
// Why the landing is snapshotted at module load rather than read when the first event
// fires: by the time App.tsx sends `app_open` the router may already have replaced the
// URL, and any later in-app navigation certainly will have. The snapshot is only the
// two raw strings; it is not resolved or persisted until an event actually needs it,
// so importing this module never starts a session or writes to storage on its own.

import {
  directAttribution,
  resolveAttribution,
  type Attribution,
} from "./analyticsAttribution";
import { getSessionId, SESSION_IDLE_TIMEOUT_MS } from "./analyticsIdentity";

const ATTRIBUTION_KEY = "cydi.analyticsAttribution.v1";

/**
 * How long a landing snapshot may still seed a NEW session.
 *
 * This is what stops a campaign being re-credited forever. A single-page document
 * keeps its landing snapshot - UTM tags and all - for as long as the tab is open, and
 * a tab left open for days still rolls its analytics session over every time it sits
 * idle for SESSION_IDLE_TIMEOUT_MS. Without this cap each of those new sessions would
 * re-read the original snapshot and be counted as another arrival from the Short.
 *
 * Deliberately equal to the session idle timeout, which makes the rule exactly "a
 * landing attributes the session it landed in, and no later one": a session can only
 * roll over after >= SESSION_IDLE_TIMEOUT_MS of inactivity, by which point the landing
 * that seeded the previous session is already too old to seed the next.
 */
const LANDING_MAX_AGE_MS = SESSION_IDLE_TIMEOUT_MS;

type StoredAttribution = { sessionId: string; attribution: Attribution };

/** The landing URL/referrer as they were when this document loaded, plus when that was. Captured eagerly; resolved lazily. */
type LandingSnapshot = { search: string; referrer: string; origin: string; at: number };

let landing: LandingSnapshot | null = null;
// Mirrors analyticsIdentity's memory fallback: when localStorage is blocked the
// visit still gets ONE consistent attribution for the life of the document, instead
// of re-resolving (and possibly re-attributing) on every event.
let memoryAttribution: StoredAttribution | null = null;

export function captureLanding(snapshot: Omit<LandingSnapshot, "at"> & { at?: number }): void {
  landing = { ...snapshot, at: snapshot.at ?? Date.now() };
}

function readStored(): StoredAttribution | null {
  try {
    const raw = localStorage.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: unknown; attribution?: unknown };
    if (typeof parsed.sessionId !== "string" || typeof parsed.attribution !== "object" || parsed.attribution === null) {
      return null;
    }
    // Re-normalized on read rather than trusted: a value that has sat in
    // localStorage across an app update must still satisfy today's format rules.
    const a = parsed.attribution as Record<string, unknown>;
    const fields = ["source", "medium", "campaign", "content", "term"] as const;
    if (fields.some((f) => typeof a[f] !== "string")) return null;
    return {
      sessionId: parsed.sessionId,
      attribution: {
        source: a.source as string,
        medium: a.medium as string,
        campaign: a.campaign as string,
        content: a.content as string,
        term: a.term as string,
      },
    };
  } catch {
    return null;
  }
}

function writeStored(record: StoredAttribution): void {
  memoryAttribution = record;
  try {
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked (private mode, storage-disabled WebView) - the in-memory copy
    // above still keeps this document's events consistent with each other.
  }
}

/**
 * The attribution every event of the current visit carries.
 *
 * Pinned to the analytics session id, which is what makes "subsequent events keep the
 * landing source" true across the whole visit, including across the separate document
 * loads the SEO pages are: the second page finds a stored record whose session id
 * still matches and reuses it, instead of re-resolving and seeing nothing but a
 * same-origin referrer.
 *
 * When the session HAS rolled over (30 minutes idle, see SESSION_IDLE_TIMEOUT_MS) the
 * new session is attributed from scratch, and only a landing that is still fresh
 * (LANDING_MAX_AGE_MS) can seed it. So a genuinely new visit that arrives with no
 * campaign and no external referrer is "direct" - it inherits nothing from the
 * earlier session, whether that session ended because the tab was closed or because
 * the same tab simply sat idle. That is deliberate: these numbers mean "sessions that
 * ARRIVED from X", and crediting a campaign for every later return would make it look
 * larger than it was.
 */
export function getAttribution(now: number = Date.now()): Attribution {
  const sessionId = getSessionId(now);
  const stored = readStored() ?? memoryAttribution;
  // Same session - including a second document of the same visit, which is what the
  // separate SEO pages are. Reused as-is, never re-resolved.
  if (stored && stored.sessionId === sessionId) return stored.attribution;

  const usable = landing !== null && now - landing.at >= 0 && now - landing.at <= LANDING_MAX_AGE_MS;
  const attribution = usable && landing !== null ? resolveAttribution(landing) : directAttribution();
  writeStored({ sessionId, attribution });
  return attribution;
}

/** Test seam: drops the in-memory copy so a test can re-resolve from a fresh landing. Never called by app code. */
export function resetAttributionForTests(): void {
  landing = null;
  memoryAttribution = null;
  try {
    localStorage.removeItem(ATTRIBUTION_KEY);
  } catch {
    // nothing to clear.
  }
}

try {
  if (typeof window !== "undefined") {
    captureLanding({
      search: window.location?.search ?? "",
      referrer: typeof document !== "undefined" ? (document.referrer ?? "") : "",
      origin: window.location?.origin ?? "",
    });
    // QA hook, same spirit as analyticsIdentity's: shows what the current visit is
    // attributed to without having to fire an event and read the network tab.
    (window as unknown as Record<string, unknown>).cydiAttribution = () => getAttribution();
  }
} catch {
  // No DOM (unit tests, Worker) - getAttribution() falls back to direct.
}
