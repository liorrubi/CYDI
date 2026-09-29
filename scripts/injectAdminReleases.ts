/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Release markers for /admin/analytics, taken from CHANGELOG.md at build time.
//
// The admin page is a static file (public/admin/analytics.html, served straight from the
// assets binding - no Worker, no API). Its daily-trend chart marks the days a release
// shipped, so the release list is inlined into the built copy of the page here, after
// `vite build` has copied it to dist/: no extra request, no hand-kept list - CHANGELOG.md
// is already written for every release.
//
// Run as part of `npm run build`. Never fails the build over a dashboard nicety: a missing
// changelog or marker is reported and the page simply shows no markers.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASES_MARKER = "/*__CYDI_RELEASES__*/[]";

export type ReleaseMarker = { version: string; date: string; android: boolean; summary: string };

/** Plain text from a markdown line: no emphasis, code ticks or link syntax. */
function plain(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every dated release heading - `## 0.55.1 - 2026-09-29` or `## Android 0.53.0 - 2026-...` -
 * with the first sentence of its entry. "unreleased" headings carry no date and are skipped.
 */
export function parseChangelogReleases(markdown: string): ReleaseMarker[] {
  const lines = markdown.split(/\r?\n/);
  const out: ReleaseMarker[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (Android )?(\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})\b/);
    if (!m) continue;
    let summary = "";
    let inNote = false;
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("## "); j++) {
      const line = lines[j].trim();
      // Skip blank lines and editorial notes in *single-asterisk italics* (such as a
      // backfilled-entry line), which may wrap over several lines.
      if (inNote) {
        if (line.endsWith("*")) inNote = false;
        continue;
      }
      if (!line) continue;
      if (/^\*[^*\s]/.test(line)) {
        inNote = !(line.length > 1 && line.endsWith("*"));
        continue;
      }
      summary = plain(line.replace(/^[-*]\s+/, ""));
      break;
    }
    const sentence = summary.split(/(?<=[.!?])\s/)[0];
    out.push({
      version: m[2],
      date: m[3],
      // Only explicit evidence: an "Android" heading, or a versionCode in the opening line.
      // Prose that merely mentions Android ("the Android app is unchanged") is not a release.
      android: Boolean(m[1]) || /\bversionCode \d+/.test(summary),
      summary: sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence,
    });
  }
  return out;
}

/** The page with the marker replaced by the release list (safe inside a <script>). */
export function injectReleases(html: string, releases: ReleaseMarker[]): string {
  if (!html.includes(RELEASES_MARKER)) throw new Error("release marker not found in the admin page");
  const json = JSON.stringify(releases).replace(/</g, "\\u003c");
  return html.replace(RELEASES_MARKER, json);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const page = join(root, "dist", "admin", "analytics.html");
  const changelog = join(root, "CHANGELOG.md");
  try {
    if (!existsSync(page)) throw new Error(`${page} not built`);
    const releases = parseChangelogReleases(readFileSync(changelog, "utf8"));
    writeFileSync(page, injectReleases(readFileSync(page, "utf8"), releases), "utf8");
    console.log(`admin analytics: ${releases.length} release markers inlined`);
  } catch (err) {
    console.warn(`admin analytics: no release markers (${(err as Error).message})`);
  }
}
