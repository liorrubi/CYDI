import type { CapacitorConfig } from "@capacitor/cli";

// appId is only easy to change before the first Play Store submission - pick
// carefully once real store listing prep begins, but freely renamable now.
const config: CapacitorConfig = {
  appId: "com.playcydi.cydi",
  appName: "CYDI",
  webDir: "dist",
};

// TEST-ONLY: exposing the WebView's Chrome DevTools socket so a release-signed
// local test APK can be driven/inspected on a device that blocks adb input
// injection (MIUI). Gated strictly behind CYDI_TEST_WEBVIEW_DEBUG=1 at build
// time - it is NEVER enabled in a normal (production) build, so no committed
// default weakens the shipped app. Must stay off for any Play build.
if (process.env.CYDI_TEST_WEBVIEW_DEBUG === "1") {
  config.android = { ...config.android, webContentsDebuggingEnabled: true };
}

export default config;
