/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The response headers for the page families that the Worker renders AND that
// scripts/prerenderPages.ts writes into dist/.
//
// A module of its own, rather than exports on worker/index.ts, for one practical
// reason: the prerender script runs under Node, and importing the whole Worker there
// drags in the entire route table for a handful of strings.
//
// Why they need to be shared at all: once a page moves off the Worker, it is the asset
// server that answers, and the asset server sets its own headers. It defaults HTML to
// `max-age=0, must-revalidate` and - measured on the real edge, not locally - serves
// these documents WITHOUT a charset. Both differences are invisible against
// `wrangler dev --local`, which adds `; charset=utf-8` of its own accord. So the
// prerender writes a `_headers` file restoring each value, and it reads them from here
// so the restored header cannot drift from the one the Worker actually sends.

/** Generated text documents - robots.txt, sitemap.xml. */
export const TEXT_RESPONSE_CACHE_CONTROL = "public, max-age=3600";

/** Content documents (/about, /privacy, ...). Short, because the copy is generated from live code at render time. */
export const CONTENT_PAGE_CACHE_CONTROL = "public, max-age=600";

/** Content documents are full HTML pages, explicitly UTF-8: they carry typographic quotes, dashes and © throughout. */
export const CONTENT_PAGE_CONTENT_TYPE = "text/html; charset=utf-8";

export const ROBOTS_CONTENT_TYPE = "text/plain; charset=utf-8";

export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";
