/**
 * Deep link parsing for the native shells. Free of browser globals so it can be tested and
 * reused on the server.
 */

/** Hosts whose links belong inside the app. */
const APP_HOST = "theninja-rpg.com";

/**
 * Whether a URL's host is ours.
 *
 * An `endsWith` check would accept `eviltheninja-rpg.com`, which is exactly how an
 * attacker gets the app to open a page they control: the host must either be the domain
 * itself or a real subdomain of it.
 */
export const isAppHost = (hostname: string): boolean =>
  hostname === APP_HOST || hostname.endsWith(`.${APP_HOST}`);

/**
 * Collapse the leading slashes of a path down to one.
 *
 * `//evil.com` and `/\evil.com` are protocol-relative URLs, not paths: handed to the
 * router they resolve against the current scheme and navigate straight out of the app.
 * Collapsing rather than rejecting keeps them pointing at our own origin, where they are
 * merely a 404.
 */
const asRelativePath = (path: string): string => path.replace(/^[/\\]+/, "/");

/**
 * The in-app path a deep link should navigate to, or `null` when the link is not ours.
 *
 * Returns a path rather than a URL so callers hand the router something that cannot
 * become an off-site navigation.
 */
export const toInternalPath = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only https: a http:// link would be a downgrade, and custom schemes are handled by
  // the flows that registered them.
  if (parsed.protocol !== "https:") return null;
  if (!isAppHost(parsed.hostname)) return null;
  return `${asRelativePath(parsed.pathname)}${parsed.search}${parsed.hash}`;
};

/**
 * A path handed to us by someone else — a notification payload — made safe to navigate to.
 *
 * Returns `null` for anything that is not already a path, so an absolute URL in a payload
 * cannot become a navigation off-site.
 */
export const toSafePath = (path: string | undefined): string | null => {
  if (!path?.startsWith("/")) return null;
  return asRelativePath(path);
};
