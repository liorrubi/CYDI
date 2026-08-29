import { ChestIcon } from "cydi";

const TIERS = ["wood", "iron", "copper", "silver", "gold", "platinum"] as const;

const cell = {
  display: "grid",
  justifyItems: "center",
  gap: "var(--space-1)",
  fontSize: 12,
  color: "var(--color-text-muted)",
};

/** Every chest tier - the palette and lid shape are what tell them apart. */
export const AllTiers = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
    {TIERS.map((tier) => (
      <span key={tier} style={cell}>
        <ChestIcon tier={tier} />
        {tier}
      </span>
    ))}
  </div>
);

/** `size` drives the SVG viewport - used small in the header, large in the reward overlay. */
export const Sizes = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
    <ChestIcon tier="gold" size={28} />
    <ChestIcon tier="gold" size={44} />
    <ChestIcon tier="gold" size={88} />
  </div>
);
