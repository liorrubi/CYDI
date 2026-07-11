import { getVisibleArtworks, type ArtistPackDefinition } from "../engine/artistPackLibrary";

type ArtistPackCardProps = {
  pack: ArtistPackDefinition;
  /** How many of the pack's visible artworks the player has a passing best score on. */
  completedCount: number;
  onClick: () => void;
};

/**
 * Entry card for one artist pack, shown in the "Artist Packs" section of the
 * Shape Challenge screen. Artist Packs are always free, so there is no lock or
 * cost UI — the card always opens the pack detail page.
 */
export default function ArtistPackCard({ pack, completedCount, onClick }: ArtistPackCardProps) {
  const total = getVisibleArtworks(pack).length;
  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <button
      type="button"
      className="artist-pack-card"
      onClick={onClick}
      aria-label={`${pack.name} by ${pack.artist.name}, ${completedCount} of ${total} artworks completed`}
    >
      <span className="artist-pack-avatar" aria-hidden="true">
        {pack.artist.avatarIcon}
      </span>
      <span className="artist-pack-body">
        <span className="artist-pack-header">
          <span className="artist-pack-title">{pack.name}</span>
          <span className="artist-pack-count">
            {completedCount}/{total}
          </span>
        </span>
        <span className="artist-pack-artist">{pack.artist.name}</span>
        <span className="artist-pack-progress-track">
          <span className="artist-pack-progress-fill" style={{ width: `${percent}%` }} />
        </span>
      </span>
      <span className="artist-pack-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}
