import { SoundToggleButton } from "cydi";

/** The Settings sound toggle. Takes no props - it reads and writes the sound preference itself. */
export const Default = () => <SoundToggleButton />;

/** How it sits in a Settings row. */
export const InSettingsRow = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-4)",
      maxWidth: 360,
      padding: "var(--space-3) var(--space-4)",
      background: "var(--color-card)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
    }}
  >
    <span style={{ color: "var(--color-text)" }}>Sound effects</span>
    <SoundToggleButton />
  </div>
);
