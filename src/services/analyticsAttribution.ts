/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Where a visit came from, as five short normalized labels. Lives in src/ and is
// imported by worker/analyticsDO.ts exactly like analyticsSchema.ts and
// analyticsUsage.ts already are, so it must stay free of DOM, Capacitor and
// `import.meta.env` - none of which exist in workerd. The DOM half (reading
// location/referrer once at landing and persisting it for the session) is in
// analyticsAttributionStore.ts.
//
// What this deliberately does NOT do: it never stores a full landing URL or a full
// referrer URL. A referrer is reduced to its HOST and then to a canonical label, and
// every UTM value is clipped to a short, closed character set. So what reaches the
// server is "youtube" / "shorts" / "cydi_shorts", never "https://www.youtube.com/
// shorts/abc?list=...&some_user_specific_thing". That is the data-minimization
// promise the privacy policy makes, enforced here rather than by caller discipline.
//
// It is also an untrusted-input boundary. Unlike platform (a closed four-value set),
// these values originate in a URL anyone can type, and they end up as KEYS in the
// counter maps the Durable Object keeps in a single storage value. An unguarded
// string here would be an arbitrary-key write primitive against that value - the same
// reasoning as normalizeAppVersion's strict format guard, one step stricter.

/** Missing or unusable - never guessed into a real source. Matches the "unknown" convention byPlatform/byAppVersion already use. */
export const ATTRIBUTION_UNKNOWN = "unknown";
/** No UTM and no external referrer: someone typed the address, used a bookmark, or arrived from a referrer-stripping surface. */
export const ATTRIBUTION_DIRECT = "direct";
/** Overflow bucket - see MAX_* caps in analyticsUsage.ts and analyticsDO.ts. A real value that arrived after a cardinality cap was reached is counted here rather than dropped. */
export const ATTRIBUTION_OTHER = "other";

/** Values are counter-map keys, so their length is bounded as hard as their alphabet. */
const MAX_VALUE_LENGTH = 32;

/**
 * The five landing labels, in the order they are conceptually resolved.
 *
 * `source` and `medium` are always present (falling back to direct/none); the other
 * three are ATTRIBUTION_UNKNOWN when the landing URL carried no such parameter.
 */
export type Attribution = {
  /** utm_source, else the canonical referring domain, else "direct". */
  source: string;
  /** utm_medium, else "referral" for an external referrer, else "none". */
  medium: string;
  /** utm_campaign. */
  campaign: string;
  /** utm_content - the per-creative slot (for CYDI, the YouTube video id). */
  content: string;
  /** utm_term. */
  term: string;
};

/** The three dimensions the server breaks counters and usage down by. `medium`/`term` are captured and reported on the landing labels but deliberately not given their own counter maps - they add cardinality without answering a question we actually ask. */
export const ATTRIBUTION_DIMENSIONS = ["source", "campaign", "content"] as const;
export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

export function directAttribution(): Attribution {
  return {
    source: ATTRIBUTION_DIRECT,
    medium: "none",
    campaign: ATTRIBUTION_UNKNOWN,
    content: ATTRIBUTION_UNKNOWN,
    term: ATTRIBUTION_UNKNOWN,
  };
}

/**
 * Clips one value to the closed alphabet above.
 *
 * `content` is the only field whose CASE is preserved: it is the opaque-id slot, and
 * for CYDI it carries a YouTube video id, which is case-sensitive ("N4H7VTj59A0" and
 * "n4h7vtj59a0" are different videos). Every other field is lowercased so that
 * `utm_source=YouTube` and `utm_source=youtube` cannot become two separate counter
 * keys for one source.
 *
 * Anything that survives to zero characters (empty, or nothing but punctuation)
 * becomes ATTRIBUTION_UNKNOWN rather than an empty-string key.
 */
export function normalizeAttributionValue(value: unknown, options: { preserveCase?: boolean } = {}): string {
  if (typeof value !== "string") return ATTRIBUTION_UNKNOWN;
  const cased = options.preserveCase === true ? value : value.toLowerCase();
  const cleaned = cased
    .trim()
    // Any character outside the allowed set collapses to a single "-", so
    // "Summer Sale!!" and "summer-sale" converge instead of one of them being
    // dropped outright.
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    // Leading/trailing separators would make "-youtube-" and "youtube" distinct keys.
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, MAX_VALUE_LENGTH)
    // The slice can re-expose a trailing separator on an over-long value.
    .replace(/[-_.]+$/g, "");
  return cleaned.length > 0 ? cleaned : ATTRIBUTION_UNKNOWN;
}

/**
 * Server-side guard: coerces whatever a client sent into a well-formed Attribution.
 *
 * Never rejects and never drops an event - an envelope with no attribution at all
 * (every build released before this field existed) normalizes to "unknown" on all
 * five fields, exactly like normalizeAppVersion does. That is what keeps existing
 * historical data valid: old events are not re-attributed, they are simply unknown.
 */
export function normalizeAttribution(value: unknown): Attribution {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    source: canonicalSource(normalizeAttributionValue(raw.source)),
    medium: normalizeAttributionValue(raw.medium),
    campaign: normalizeAttributionValue(raw.campaign),
    content: normalizeAttributionValue(raw.content, { preserveCase: true }),
    term: normalizeAttributionValue(raw.term),
  };
}

// Hosts that all mean "YouTube": the desktop and mobile sites, the share shortener,
// and l.youtube.com, which is the interstitial YouTube sends outbound clicks through.
// Matched on the registrable tail so regional hosts (youtube.co.uk, youtube.de) and
// any future subdomain collapse to the same label without a list to maintain.
const YOUTUBE_HOST_PATTERN = /(^|\.)(youtube\.[a-z.]{2,6}|youtu\.be|youtube-nocookie\.com)$/;
// Android sends the referring app rather than a URL when a link is opened from a
// native app (a YouTube Short opened in a Custom Tab is the common case for CYDI),
// so the package name is the only signal there is.
const ANDROID_APP_REFERRER = /^android-app:\/\/([a-z0-9_.]+)/i;
const YOUTUBE_PACKAGES = new Set(["com.google.android.youtube", "com.google.android.apps.youtube.music"]);

/** Collapses every YouTube spelling - host, alias, or Android package - onto one label, so `utm_source=m.youtube.com` and a bare youtu.be referrer are the same source. */
function canonicalSource(value: string): string {
  if (value === ATTRIBUTION_UNKNOWN) return value;
  // utm_source is frequently written as a hostname ("m.youtube.com"), so the host
  // rules have to apply to the UTM path too, not only to referrers.
  if (YOUTUBE_HOST_PATTERN.test(value) || value === "youtube" || YOUTUBE_PACKAGES.has(value)) return "youtube";
  return value;
}

/**
 * Reduces a referrer to a source label, or null when it is not an external referral.
 *
 * Returns null for a same-origin referrer, which is the case that matters most for
 * correctness: CYDI's SEO pages are separate documents, so clicking from "/" to
 * "/how-to-play" hands the next page a playcydi.com referrer. Treating that as a
 * referral would re-attribute every internal click to ourselves and quietly destroy
 * the campaign numbers.
 */
export function sourceFromReferrer(referrer: string, origin: string): string | null {
  const trimmed = referrer.trim();
  if (trimmed.length === 0) return null;

  const androidApp = ANDROID_APP_REFERRER.exec(trimmed);
  if (androidApp) {
    const pkg = androidApp[1].toLowerCase();
    return YOUTUBE_PACKAGES.has(pkg) ? "youtube" : normalizeAttributionValue(pkg);
  }

  let host: string;
  try {
    const url = new URL(trimmed);
    // Same origin - an internal navigation, not a referral. Compared on host alone
    // so http/https and a port difference between dev and prod cannot make the site
    // look external to itself.
    if (origin.length > 0) {
      try {
        if (new URL(origin).hostname.toLowerCase() === url.hostname.toLowerCase()) return null;
      } catch {
        // Unparseable origin - fall through and treat the referrer as external.
      }
    }
    host = url.hostname.toLowerCase();
  } catch {
    // Not a URL at all (some WebViews hand over junk) - nothing usable.
    return null;
  }

  if (host.length === 0) return null;
  if (YOUTUBE_HOST_PATTERN.test(host)) return "youtube";
  // "www." carries no information and would split one domain across two keys.
  return normalizeAttributionValue(host.replace(/^www\./, ""));
}

/**
 * The landing decision, as a pure function of the three strings a browser can supply.
 *
 * Precedence is explicit and is the rule the brief asks for: an explicit utm_source
 * always wins over whatever the referrer says, because a tagged link is a deliberate
 * statement about the campaign and the referrer is a side effect. A YouTube referral
 * with no UTM still resolves to "youtube"; everything else with no UTM and no
 * external referrer is "direct".
 */
export function resolveAttribution(input: { search: string; referrer: string; origin: string }): Attribution {
  const params = new URLSearchParams(input.search);
  const utmSource = params.get("utm_source");
  const referrerSource = sourceFromReferrer(input.referrer, input.origin);

  const campaign = normalizeAttributionValue(params.get("utm_campaign"));
  const content = normalizeAttributionValue(params.get("utm_content"), { preserveCase: true });
  const term = normalizeAttributionValue(params.get("utm_term"));
  const medium = normalizeAttributionValue(params.get("utm_medium"));

  if (utmSource !== null && normalizeAttributionValue(utmSource) !== ATTRIBUTION_UNKNOWN) {
    return {
      source: canonicalSource(normalizeAttributionValue(utmSource)),
      // A tagged link with no utm_medium is still a referral if we can see where it
      // came from; only a genuinely unattributable one stays "unknown".
      medium: medium !== ATTRIBUTION_UNKNOWN ? medium : referrerSource !== null ? "referral" : ATTRIBUTION_UNKNOWN,
      campaign,
      content,
      term,
    };
  }

  if (referrerSource !== null) {
    return {
      source: referrerSource,
      medium: medium !== ATTRIBUTION_UNKNOWN ? medium : "referral",
      campaign,
      content,
      term,
    };
  }

  // No source signal at all. UTM values that arrived without a utm_source are still
  // kept - a link tagged with only utm_campaign is unusual but not meaningless.
  return { ...directAttribution(), medium: medium !== ATTRIBUTION_UNKNOWN ? medium : "none", campaign, content, term };
}
