/**
 * The single import surface between the web app and the native shell.
 *
 * Two kinds of export live here, and the difference is deliberate:
 *
 * **Fire-and-forget** — `haptics`, `widgets`, `audioSession`, `liveActivity` — resolve to
 * no-ops off-device, so a combat handler calls `haptics.impact("HEAVY")` with no platform
 * check and nothing happens in a desktop browser.
 *
 * **Result-bearing** — `appleAuth.authorize`, `oauthBrowser.open`, `purchases.purchase`,
 * `push.register` — reject when the shell cannot service them. Swallowing those would be
 * worse than throwing: a sign-in that silently resolves without opening a browser leaves
 * the caller waiting on a redirect that will never arrive. Each is called from a path
 * that has already established it is running in the shell.
 *
 * A biome `noRestrictedImports` rule keeps `@capacitor/*` and `./bridge` from being
 * imported anywhere else under `src/`.
 */

export * as appEvents from "./appEvents";
export * as appleAuth from "./appleAuth";
export * as audioSession from "./audioSession";
export {
  getPlatform as platform,
  hasPlugin,
  isNative,
  NativeBridgeError,
} from "./bridge";
export { isAppHost, toInternalPath, toSafePath } from "./deepLink";
export * as haptics from "./haptics";
export * as liveActivity from "./liveActivity";
export * as oauthBrowser from "./oauthBrowser";
export * as purchases from "./purchases";
export * as push from "./push";
export {
  compareVersions,
  isNativeUserAgent,
  isOutdatedNativeClient,
  type NativeClient,
  parseNativeUserAgent,
} from "./userAgent";
export * as widgets from "./widgetBridge";

export type NativePlatform = "ios" | "android" | "web";
