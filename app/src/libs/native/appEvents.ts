/**
 * App lifecycle and deep links, from `@capacitor/app`.
 *
 * Every subscriber returns an unsubscribe function that is safe to call unconditionally,
 * so effects can return it whether or not the listener was ever attached.
 */

import { addNativeListener, invokeSafe, isNative } from "./bridge";

const PLUGIN = "App";

/**
 * A URL the OS handed to the app: a Universal Link into the game, or the `tnr://` return
 * leg of a social sign-in that ran in the system browser.
 */
export const onUrlOpen = (callback: (url: string) => void): (() => void) =>
  addNativeListener(PLUGIN, "appUrlOpen", (data) => {
    const url = (data as { url?: unknown } | null)?.url;
    if (typeof url === "string") callback(url);
  });

/**
 * Foreground and background transitions. The WebSocket drops while backgrounded, so the
 * realtime layer reconnects on the way back in rather than waiting to notice.
 */
export const onStateChange = (callback: (isActive: boolean) => void): (() => void) =>
  addNativeListener(PLUGIN, "appStateChange", (data) => {
    const isActive = (data as { isActive?: unknown } | null)?.isActive;
    if (typeof isActive === "boolean") callback(isActive);
  });

/**
 * The Android hardware back button. Capacitor's default is to exit the app from anywhere,
 * which loses the player's session from a menu three levels deep; handling it explicitly
 * is a Play review expectation as much as a usability one.
 */
export const onBackButton = (callback: (canGoBack: boolean) => void): (() => void) =>
  addNativeListener(PLUGIN, "backButton", (data) => {
    const canGoBack = (data as { canGoBack?: unknown } | null)?.canGoBack;
    callback(canGoBack === true);
  });

/** Close the app. Only correct in response to back at the root of the history stack. */
export const exitApp = async (): Promise<void> => {
  if (!isNative()) return;
  await invokeSafe(PLUGIN, "exitApp");
};
