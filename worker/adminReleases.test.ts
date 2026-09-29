// Release markers for the admin dashboard's trend chart, parsed from CHANGELOG.md at build
// time and inlined into the static page (scripts/injectAdminReleases.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { parseChangelogReleases, injectReleases, RELEASES_MARKER } = await import("../scripts/injectAdminReleases.ts");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("dated headings become markers; unreleased ones and editorial notes are skipped", () => {
  const md = [
    "# Changelog",
    "",
    "## 0.55.1 - 2026-09-29",
    "",
    "Web only - Android is unchanged. **playcydi.com/join works again.** More text.",
    "",
    "## 0.55.0 - 2026-09-29",
    "",
    "*Entry added on 29 Sep 2026 from the release commits (b980cb4, 78e5f8c);",
    "the release shipped without one.*",
    "",
    "Android 0.55.0 (versionCode 53) and web 0.55.0.",
    "",
    "## Android 0.53.0 - unreleased (versionCode 48 release candidate)",
    "",
    "Nothing dated here.",
  ].join("\n");
  const r = parseChangelogReleases(md);
  assert.deepEqual(r.map((x) => x.version), ["0.55.1", "0.55.0"]);
  assert.equal(r[0].summary, "Web only - Android is unchanged.");
  assert.equal(r[0].android, false, "'Android is unchanged' is not an Android release");
  assert.equal(r[1].summary, "Android 0.55.0 (versionCode 53) and web 0.55.0.");
  assert.equal(r[1].android, true);
});

test("the real changelog yields markers for the recent releases, 0.54.0 and 0.55.0 included", () => {
  const r = parseChangelogReleases(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
  const versions = r.map((x) => x.version);
  for (const v of ["0.55.1", "0.55.0", "0.54.2", "0.54.1", "0.54.0", "0.53.1"]) assert.ok(versions.includes(v), `${v} has a marker`);
  assert.ok(r.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  const byVersion = (v: string) => r.find((x) => x.version === v)!;
  assert.equal(byVersion("0.55.0").android, true, "Android 0.55.0 / vc53");
  assert.equal(byVersion("0.54.0").android, true, "Android 0.54.0 / vc52");
  assert.equal(byVersion("0.54.1").android, false, "web only");
  assert.equal(byVersion("0.55.1").android, false, "web only");
  assert.ok(r.every((x) => !/^Entry added/.test(x.summary)), "an editorial note is never a summary");
});

test("the admin page carries exactly one marker, and injection is script-safe", () => {
  const html = readFileSync(join(ROOT, "public", "admin", "analytics.html"), "utf8");
  assert.equal(html.split(RELEASES_MARKER).length, 2, "one marker in the page");
  const out = injectReleases(`<script>var R = ${RELEASES_MARKER};</script>`, [{ version: "1.0.0", date: "2026-01-01", android: false, summary: "</script><b>x" }]);
  assert.doesNotMatch(out, /<\/script><b>/, "a changelog line cannot close the script");
  assert.throws(() => injectReleases("<html></html>", []), /marker not found/);
});
