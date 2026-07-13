import type { CapacitorConfig } from "@capacitor/cli";

// appId is only easy to change before the first Play Store submission - pick
// carefully once real store listing prep begins, but freely renamable now.
const config: CapacitorConfig = {
  appId: "com.playcydi.cydi",
  appName: "CYDI",
  webDir: "dist",
};

export default config;
