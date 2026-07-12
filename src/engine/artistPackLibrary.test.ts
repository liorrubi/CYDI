import test from "node:test";
import assert from "node:assert/strict";
import { getArtistPackById, getPublishedArtworks, resolvePublishedArtwork, type ArtistPackDefinition } from "./artistPackLibrary.ts";

// `resolvePublishedArtwork` looks up the real, baked-in catalog (there is no
// injection point), so these first three tests exercise it against the actual
// shipped "nimco" pack.

test("resolvePublishedArtwork resolves a real published artwork", () => {
  const artwork = resolvePublishedArtwork("nimco", "nimco-portrait");
  assert.ok(artwork, "should resolve the real published artwork");
  assert.strictEqual(artwork!.id, "nimco-portrait");
});

test("resolvePublishedArtwork returns undefined for an unknown pack id", () => {
  assert.strictEqual(resolvePublishedArtwork("not-a-real-pack", "nimco-portrait"), undefined);
});

test("resolvePublishedArtwork returns undefined for an unknown artwork id within a real pack", () => {
  assert.strictEqual(resolvePublishedArtwork("nimco", "not-a-real-artwork"), undefined);
});

// Every artwork in the current catalog happens to be "published" (there is no
// draft/approved artwork shipped right now), so the "real but unpublished"
// case can't be exercised through resolvePublishedArtwork against the live
// catalog. It's covered here instead against `getPublishedArtworks` - the
// exact filter resolvePublishedArtwork delegates to - using a fabricated pack.

test("getPublishedArtworks excludes draft/approved artwork, never substituting another artwork", () => {
  const fixture: ArtistPackDefinition = {
    id: "test-pack",
    artist: { id: "test-artist", name: "Test Artist", avatarIcon: "🎨", bio: "", externalUrl: "https://example.com" },
    name: "Test Pack",
    artworks: [
      { id: "draft-one", name: "Draft One", category: "nature", status: "draft", generate: (size) => ({ points: [], canvasWidth: size, canvasHeight: size }) },
      { id: "approved-one", name: "Approved One", category: "nature", status: "approved", generate: (size) => ({ points: [], canvasWidth: size, canvasHeight: size }) },
      { id: "published-one", name: "Published One", category: "nature", status: "published", generate: (size) => ({ points: [], canvasWidth: size, canvasHeight: size }) },
    ],
  };

  const published = getPublishedArtworks(fixture);
  assert.deepEqual(
    published.map((a) => a.id),
    ["published-one"],
  );
});

test("getArtistPackById returns undefined for an unknown pack (sanity check for the resolve chain)", () => {
  assert.strictEqual(getArtistPackById("not-a-real-pack"), undefined);
});
