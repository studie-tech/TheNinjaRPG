import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Shell version. Keep in step with `version` in package.json — it is appended to the
 * WebView user agent, and the server reads it to gate features and to require an update
 * when a binary falls too far behind.
 */
const APP_VERSION = "1.0.0";

/**
 * The origin the shell navigates to once connectivity is confirmed. Override for staging
 * with `TNR_ORIGIN=https://staging... bun run sync`.
 */
const ORIGIN = process.env.TNR_ORIGIN ?? "https://www.theninja-rpg.com";
const ORIGIN_HOST = new URL(ORIGIN).host;
const APEX_HOST = ORIGIN_HOST.replace(/^www\./, "");

const config: CapacitorConfig = {
  appId: process.env.TNR_APP_ID ?? "com.theninjarpg.app",
  appName: "TheNinja-RPG",

  // Deliberately NOT `server.url`. Pointing the WebView straight at production leaves a
  // blank screen on a cold launch with no connectivity, and Ionic treats remote-origin
  // loading as a development feature that can attract store rejections. Instead the app
  // boots into the bundled entry point below, which checks reachability and only then
  // navigates to the live site.
  webDir: "www",

  server: {
    androidScheme: "https",
    iosScheme: "https",
    // Keeps that navigation inside the WebView — and the Capacitor bridge with it —
    // rather than handing the URL to the system browser.
    //
    // The apex is listed in its own right: both matchers compare host labels one for one,
    // so `*.theninja-rpg.com` does not cover `theninja-rpg.com`. The Android manifest
    // registers the apex as an App Link host, so leaving it out would mean a link the app
    // claims it can open is one it then refuses to navigate to.
    allowNavigation: [
      ORIGIN_HOST,
      APEX_HOST,
      `*.${APEX_HOST}`,
    ],
  },

  ios: {
    // Matches the bundled entry point and the splash, so the strip outside the safe area
    // is never a white flash on launch.
    backgroundColor: "#f0c84c",
    contentInset: "always",
    appendUserAgent: `TNR-Native/${APP_VERSION} (ios)`,
  },

  android: {
    backgroundColor: "#f0c84c",
    appendUserAgent: `TNR-Native/${APP_VERSION} (android)`,
    allowMixedContent: false,
  },

  plugins: {
    PushNotifications: {
      // Alerts still show while the app is in the foreground; the game is played in short
      // bursts and a silent notification during play reads as a bug.
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      // The bundled entry point draws its own splash, so the native one only needs to
      // cover the very first frame.
      launchShowDuration: 0,
      backgroundColor: "#f0c84c",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
    },
  },
};

export default config;
