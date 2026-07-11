import { getVisibleArtworks, packHasPublishedArtwork, type ArtistPackDefinition } from "../engine/artistPackLibrary";

type ArtistPackCardProps = {
  pack: ArtistPackDefinition;
  /** How many of the pack's visible artworks the player has a passing best score on. */
  completedCount: number;
  onClick: () => void;
};

/**
 * Entry card for one artist pack in the Artist Packs section. Artist Packs are
 * always free, so there is no lock or cost UI. A pack with no published artwork
 * shows as a "Coming Soon" card that is non-clickable in production (in a dev
 * build it stays openable so the owner can review draft/approved artwork).
 */
export default function ArtistPackCard({ pack, completedCount, onClick }: ArtistPackCardProps) {
  const total = getVisibleArtworks(pack).length;
  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const comingSoon = !packHasPublishedArtwork(pack);
  // Coming-soon packs never open for players; kept openable in dev for review.
  const disabled = comingSoon && import.meta.env.PROD;

  return (
    <button
      type="button"
      className={comingSoon ? "artist-pack-card artist-pack-card-coming-soon" : "artist-pack-card"}
      onClick={onClick}
      disabled={disabled}
      aria-label={
        comingSoon
          ? `${pack.name} by ${pack.artist.name}, coming soon`
          : `${pack.name} by ${pack.artist.name}, ${completedCount} of ${total} artworks completed`
      }
    >
      {pack.artist.avatarImageUrl ? (
        <span className="artist-pack-avatar">
          <img
            className="artist-pack-avatar-img"
            src={pack.artist.avatarImageUrl}
            alt={pack.artist.avatarImageAlt}
          />
        </span>
      ) : (
        <span className="artist-pack-avatar" aria-hidden="true">
          {pack.artist.avatarIcon}
        </span>
      )}
      <span className="artist-pack-body">
        <span className="artist-pack-header">
          <span className="artist-pack-title">{pack.name}</span>
          {comingSoon ? (
            <span className="artist-pack-coming-soon-badge">Coming Soon</span>
          ) : (
            <span className="artist-pack-count">
              {completedCount}/{total}
            </span>
          )}
        </span>
        <span className="artist-pack-artist">{pack.artist.name}</span>
        {comingSoon ? (
          <span className="artist-pack-unlock-hint">New artworks on the way</span>
        ) : (
          <span className="artist-pack-progress-track">
            <span className="artist-pack-progress-fill" style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
      {!comingSoon && (
        <span className="artist-pack-arrow" aria-hidden="true">
          →
        </span>
      )}
    </button>
  );
}
