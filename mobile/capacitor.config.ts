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
    // The apex is listed in its own right because both matchers compare host labels one
    // for one, so `*.theninja-rpg.com` does not cover `theninja-rpg.com`. It redirects to
    // www in production and is deliberately not claimed as an App/Universal Link host:
    // association-file verification does not follow that redirect.
    allowNavigation: [
      ORIGIN_HOST,
      APEX_HOST,
      `*.${APEX_HOST}`,
    ],
  },

  ios: {
    // Sampled from the sky at the edge of the launch image.
    //
    // This colour fills the second or so between the launch image going away and the
    // WebView having a page to draw — measured at eleven frames on a simulator, and not
    // something the page can shorten, since it is over before index.html is parsed. Any
    // other value is a full-screen flash between two pictures of the same sky.
    //
    // It is also what shows behind a rubber-band overscroll on the live site, where the
    // right answer would be the site's own background — yellow-50 in light, navy in dark.
    // The setting takes one value and cannot follow the theme, so it goes to the case it
    // can actually serve: a guaranteed full-screen moment beats an occasional sliver.
    backgroundColor: "#8bbccf",
    contentInset: "always",
    appendUserAgent: `TNR-Native/${APP_VERSION} (ios)`,
  },

  android: {
    backgroundColor: "#8bbccf",
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
      backgroundColor: "#8bbccf",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
    },
  },
};

export default config;
