/**
 * The single import surface between the web app and the native shell.
 *
 * Every export here is safe to call unconditionally: off-device the feature modules
 * resolve to no-ops, so a combat handler calls `haptics.impact("heavy")` with no platform
 * check and nothing happens in a desktop browser. A biome `noRestrictedImports` rule keeps
 * `@capacitor/*` and `./bridge` from being imported anywhere else under `src/`.
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
export { isAppHost, toInternalPath } from "./deepLink";
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
