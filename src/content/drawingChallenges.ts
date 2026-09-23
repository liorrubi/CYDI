/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The single-shape challenges that have a page of their own.
 *
 * ONE list, read by both sides of /drawing-challenges: the Worker builds the
 * crawlable links from it (worker/seoPages.ts) and the site renders the cards
 * from it (src/site/SiteChallenges.tsx), so the page a crawler reads and the
 * page a visitor sees can never list different challenges.
 *
 * Nothing is generated from the catalogue here on purpose: an entry exists only
 * once there is a real page behind it, so the hub can never advertise a
 * challenge that 404s. Adding the next one - Spiral, Fox, Rabbit - is
 * one entry here plus its own landing page.
 *
 * `shapeId` is the catalogue id the card previews, drawn by the game's own
 * ShapePreviewIcon (via SiteShape), so a card can never drift from the target
 * the challenge behind it actually asks for.
 */
export type DrawingChallenge = {
  /** The challenge page. Also its entry in the SEO landing paths. */
  href: string;
  /** Card title, and the anchor text a crawler sees. */
  name: string;
  /** One line. The card is a doorway, not a description. */
  note: string;
  /** Catalogue id for the preview. */
  shapeId: string;
};

export const DRAWING_CHALLENGES: DrawingChallenge[] = [
  {
    href: "/draw-a-perfect-circle",
    name: "Draw a perfect circle",
    note: "One unbroken curve, and it has to close exactly where it started.",
    shapeId: "circle",
  },
  {
    href: "/draw-a-perfect-star",
    name: "Draw a perfect star",
    note: "Five arms of equal length, and ten straight edges to keep straight.",
    shapeId: "star-5",
  },
  {
    href: "/draw-a-perfect-heart",
    name: "Draw a perfect heart",
    note: "Two mirrored lobes, with the dip and the point on one centre line.",
    shapeId: "sym-heart",
  },
  {
    href: "/draw-a-cat-from-memory",
    name: "Draw a cat from memory",
    note: "Ears, whiskers and all - from memory, once the target has gone.",
    shapeId: "ani-cat",
  },
  {
    href: "/draw-a-dog-from-memory",
    name: "Draw a dog from memory",
    note: "The target disappears before you start. Redraw it from memory.",
    shapeId: "ani-dog",
  },
  {
    href: "/draw-a-bear-from-memory",
    name: "Draw a bear from memory",
    note: "A round head, two ears high on it, and a muzzle that moves in memory.",
    shapeId: "ani-bear",
  },
  {
    href: "/draw-an-owl-from-memory",
    name: "Draw an owl from memory",
    note: "Ear tufts in the outline, and eyes bigger than anyone remembers.",
    shapeId: "ani-owl",
  },
  {
    href: "/draw-a-pig-from-memory",
    name: "Draw a pig from memory",
    note: "The snout is the whole pig, and memory draws it too small.",
    shapeId: "ani-pig",
  },
  {
    href: "/draw-a-snail-from-memory",
    name: "Draw a snail from memory",
    note: "A spiral with a real number of turns, and memory smooths it.",
    shapeId: "ani-snail",
  },
  {
    href: "/draw-a-lightning-bolt-from-memory",
    name: "Draw a lightning bolt from memory",
    note: "All straight edges, and it leans further than anyone remembers.",
    shapeId: "sym-lightning",
  },
];
