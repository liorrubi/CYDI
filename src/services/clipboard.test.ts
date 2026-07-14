// Proves the clipboard copy strategy: prefer the async Clipboard API, fall back to
// the synchronous DOM method when it's missing or fails, and never throw - callers
// rely on the boolean result to decide whether to show a "copy manually" hint.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { copyTextToClipboard } from "./clipboard.ts";

test("uses the Clipboard API when available and never touches the fallback", async () => {
  const calls: string[] = [];
  const ok = await copyTextToClipboard("abc", {
    clipboardWrite: async (t) => {
      calls.push("clipboard:" + t);
    },
    fallbackCopy: () => {
      calls.push("fallback");
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["clipboard:abc"]);
});

test("falls back to the synchronous method when the Clipboard API rejects", async () => {
  const calls: string[] = [];
  const ok = await copyTextToClipboard("xyz", {
    clipboardWrite: async () => {
      throw new Error("blocked (e.g. non-secure context)");
    },
    fallbackCopy: (t) => {
      calls.push("fallback:" + t);
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["fallback:xyz"]);
});

test("uses the fallback when no Clipboard API is present", async () => {
  const ok = await copyTextToClipboard("id-123", { fallbackCopy: (t) => t === "id-123" });
  assert.equal(ok, true);
});

test("returns false (no throw) when neither method works", async () => {
  const ok = await copyTextToClipboard("id", {
    clipboardWrite: async () => {
      throw new Error("nope");
    },
    fallbackCopy: () => false,
  });
  assert.equal(ok, false);
});

test("returns false when there is no clipboard support at all", async () => {
  const ok = await copyTextToClipboard("id", {});
  assert.equal(ok, false);
});

test("a throwing fallback is caught and reported as failure, never propagated", async () => {
  const ok = await copyTextToClipboard("id", {
    fallbackCopy: () => {
      throw new Error("DOM exploded");
    },
  });
  assert.equal(ok, false);
});
