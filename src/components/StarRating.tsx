import { starRatingForScore } from "../app/constants";

type StarRatingProps = {
  score: number;
  size?: number;
};

export default function StarRating({ score, size }: StarRatingProps) {
  const filled = starRatingForScore(score);

  return (
    <span
      className="star-rating"
      style={size ? { fontSize: size } : undefined}
      aria-label={`${filled} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < filled ? "star star-filled" : "star star-empty"} aria-hidden="true">
          {i < filled ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}
