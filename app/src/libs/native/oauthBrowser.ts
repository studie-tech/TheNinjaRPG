/**
 * Social sign-in from the native shell.
 *
 * Google rejects OAuth from embedded user agents with `disallowed_useragent`, and the
 * shell is a WebView, so "Continue with Google" cannot run in-page. RFC 8252 requires the
 * system browser for exactly this reason. These helpers push the authorization URL into
 * SFSafariViewController / Chrome Custom Tabs and let the deep link bring the player back.
 */

import { addNativeListener, invoke, invokeSafe, isNative } from "./bridge";

const PLUGIN = "Browser";

/**
 * Providers that must leave the WebView. Apple is absent deliberately: it uses the native
 * sheet in `appleAuth` instead.
 */
export const EXTERNAL_OAUTH_PROVIDERS = [
  "google",
  "discord",
  "facebook",
  "github",
] as const;
export type ExternalOAuthProvider = (typeof EXTERNAL_OAUTH_PROVIDERS)[number];

export const requiresSystemBrowser = (provider: string): boolean =>
  isNative() &&
  (EXTERNAL_OAUTH_PROVIDERS as readonly string[]).includes(
    provider.replace("oauth_", ""),
  );

/**
 * Open a URL in the system browser.
 *
 * Rejects rather than no-opping off-device, unlike the fire-and-forget modules alongside
 * it. The caller waits for a deep link back from this browser, so resolving without
 * having opened anything would hang the sign-in instead of failing it.
 */
export const open = async (url: string): Promise<void> => {
  await invoke(PLUGIN, "open", { url, presentationStyle: "popover" });
};

/**
 * Close the browser sheet. Android dismisses Custom Tabs on its own once the deep link
 * fires, so this is a no-op there.
 */
export const close = async (): Promise<void> => {
  await invokeSafe(PLUGIN, "close");
};

/**
 * The player dismissed the browser sheet.
 *
 * Without this a cancelled sign-in never settles: the deep link the caller is waiting for
 * only arrives when the provider redirects, so closing the sheet leaves the promise
 * pending and the UI stuck. Returns an unsubscribe that is safe to call unconditionally.
 */
export const onFinished = (callback: () => void): (() => void) =>
  addNativeListener(PLUGIN, "browserFinished", () => callback());
