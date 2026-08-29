import { ArtistPackCard } from "cydi";

const noop = () => {};

const artist = {
  id: "nimrod-cohen",
  name: "Nimrod Cohen",
  avatarIcon: "🎨",
  bio: "Impact Through Design",
  externalUrl: "https://example.com/",
};

/** Artwork is just a ShapeDefinition plus a pack id and a publishing status. */
function artwork(id: string, name: string, status: "published" | "draft") {
  return {
    id,
    name,
    category: "nature",
    packId: "studio",
    status,
    generate: (size: number) => ({
      points: [
        { x: 0.2 * size, y: 0.8 * size, t: 0 },
        { x: 0.5 * size, y: 0.2 * size, t: 1 },
        { x: 0.8 * size, y: 0.8 * size, t: 2 },
        { x: 0.2 * size, y: 0.8 * size, t: 3 },
      ],
      canvasWidth: size,
      canvasHeight: size,
    }),
  };
}

const PUBLISHED_PACK = {
  id: "studio",
  name: "Nimco Design",
  artist,
  artworks: [
    artwork("portrait", "Portrait Study", "published"),
    artwork("hoop", "Basketball Hoop", "published"),
    artwork("sax", "Saxophonist", "published"),
    artwork("bird", "Heron", "published"),
  ],
};

const UNSTARTED_PACK = { ...PUBLISHED_PACK, id: "unstarted", name: "Line & Ink" };

/** A pack partway through - the progress figure is the player's completed count. */
export const InProgress = () => (
  <div style={{ maxWidth: 360 }}>
    <ArtistPackCard pack={PUBLISHED_PACK} completedCount={2} onClick={noop} />
  </div>
);

/** Nothing completed yet. */
export const NotStarted = () => (
  <div style={{ maxWidth: 360 }}>
    <ArtistPackCard pack={UNSTARTED_PACK} completedCount={0} onClick={noop} />
  </div>
);

/** Every artwork done. Artist Packs are always free - there is deliberately no lock or cost UI. */
export const Completed = () => (
  <div style={{ maxWidth: 360 }}>
    <ArtistPackCard pack={PUBLISHED_PACK} completedCount={4} onClick={noop} />
  </div>
);

/** A grid of packs, as the Artist Packs section shows them. */
export const InGrid = () => (
  <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", maxWidth: 640 }}>
    <ArtistPackCard pack={PUBLISHED_PACK} completedCount={2} onClick={noop} />
    <ArtistPackCard pack={UNSTARTED_PACK} completedCount={0} onClick={noop} />
  </div>
);
