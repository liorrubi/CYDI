import { StarRating } from "cydi";

const row = { display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap" as const };

/** The rating ladder - a score maps to 1-5 filled stars. */
export const Scale = () => (
  <div style={{ display: "grid", gap: "var(--space-2)" }}>
    {[35, 55, 72, 88, 97].map((score) => (
      <div key={score} style={row}>
        <StarRating score={score} />
        <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>score {score}</span>
      </div>
    ))}
  </div>
);

/** `size` scales the stars for headline use on a result screen. */
export const Sizes = () => (
  <div style={row}>
    <StarRating score={88} size={14} />
    <StarRating score={88} size={22} />
    <StarRating score={88} size={34} />
  </div>
);
