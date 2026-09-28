/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// A real 404 for addresses the site does not have.
//
// THE PROBLEM. The assets binding runs in single-page-application mode, so any
// path without a file behind it is answered with index.html - which is the
// prerendered homepage, with a 200 and the homepage's canonical. Every mistyped
// or invented URL was therefore a perfect copy of "/": an unbounded set of
// duplicate pages, and the classic soft-404 search engines and ad reviewers
// flag as low value.
//
// THE FIX, and what it costs. Nothing new is fetched. The Worker already makes
// exactly one env.ASSETS.fetch() for these requests; this only looks at the
// response it already has. When the path is not one the app serves AND that
// response is the HTML fallback, the fallback is swapped for a small 404
// document built from the content-page renderer. Real files that happen to
// reach the Worker (/ads.txt, say) are not HTML fallbacks and pass through
// untouched. No KV, no Durable Object, no analytics, no second request.
//
// The list of real routes is built from the constants the app itself routes on,
// never retyped here, so a route App.tsx serves cannot 404 by drift.
import { JOIN_LINK_PATH_PATTERN, SHORT_LINK_PATH_PATTERN } from "../src/app/appLinks";
import { CLASSIC_PATH, PLAY_PATH } from "../src/app/webPaths";
import { isDailyChallengeSharePath } from "../src/services/dailyChallengeShare";
import { CONTENT_PATHS, NOT_FOUND_PAGE, renderContentDocument } from "./contentPages";
import { CONTENT_PAGE_CACHE_CONTROL, CONTENT_PAGE_CONTENT_TYPE } from "./cachePolicy";
import { LANDING_PATHS } from "./seoPages";

/** Exact paths the app or the Worker serves as a page. Trailing slashes are tolerated. */
const PAGE_PATHS = new Set<string>(["/", PLAY_PATH, CLASSIC_PATH, ...LANDING_PATHS, ...CONTENT_PATHS]);

/**
 * True for every address that is a real page: the site and game paths, the
 * landing and content pages, and the three parameterised app routes - the
 * Daily Challenge share (/daily), a Play Together invite (/join/<code>) and a
 * share link (/c/<id>).
 */
export function isAppRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (PAGE_PATHS.has(normalized)) return true;
  if (isDailyChallengeSharePath(pathname)) return true;
  if (JOIN_LINK_PATH_PATTERN.test(pathname)) return true;
  return SHORT_LINK_PATH_PATTERN.test(pathname);
}

/** The assets binding's SPA fallback: a 200 HTML document standing in for a file that does not exist. */
export function isHtmlFallback(response: Response): boolean {
  return response.status === 200 && (response.headers.get("content-type") ?? "").startsWith("text/html");
}

/** Rendered once per isolate: the document is static. */
let notFoundBody: string | undefined;

export function notFoundResponse(method: string): Response {
  notFoundBody ??= renderContentDocument(NOT_FOUND_PAGE);
  return new Response(method === "HEAD" ? null : notFoundBody, {
    status: 404,
    headers: {
      "content-type": CONTENT_PAGE_CONTENT_TYPE,
      "cache-control": CONTENT_PAGE_CACHE_CONTROL,
      "x-robots-tag": "noindex",
    },
  });
}
