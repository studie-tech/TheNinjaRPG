/**
 * User-agent parsing for the native shell marker. Kept free of browser globals so that
 * server components, route handlers and tRPC procedures can branch on it too.
 *
 * The shell appends `TNR-Native/<version> (<platform>)` to the WebView user agent.
 */

import { NATIVE_UA_MARKER, type PushPlatform } from "@/drizzle/constants";

export interface NativeClient {
  version: string;
  platform: Extract<PushPlatform, "ios" | "android">;
}

const NATIVE_UA_PATTERN = /TNR-Native\/(\d+(?:\.\d+)*)\s*\((ios|android)\)/i;

/** Parse the shell marker out of a user agent, or `null` for ordinary browsers. */
export const parseNativeUserAgent = (
  userAgent: string | null | undefined,
): NativeClient | null => {
  if (!userAgent?.includes(NATIVE_UA_MARKER)) return null;
  const match = NATIVE_UA_PATTERN.exec(userAgent);
  if (!match) return null;
  const [, version, platform] = match;
  if (!version || !platform) return null;
  return { version, platform: platform.toLowerCase() as NativeClient["platform"] };
};

/** Whether a request came from the native shell. */
export const isNativeUserAgent = (userAgent: string | null | undefined): boolean =>
  parseNativeUserAgent(userAgent) !== null;

/**
 * Compare two dot-separated versions. Returns a negative number when `a` is older than
 * `b`, zero when equal, positive when newer. Missing segments count as zero, so
 * "1.2" and "1.2.0" are equal.
 */
export const compareVersions = (a: string, b: string): number => {
  const left = a.split(".");
  const right = b.split(".");
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = Number.parseInt(left[i] ?? "0", 10) || 0;
    const r = Number.parseInt(right[i] ?? "0", 10) || 0;
    if (l !== r) return l - r;
  }
  return 0;
};

/**
 * Whether a native client is too old to be served. The web app uses this to show an
 * update wall rather than letting a stale binary hit endpoints it cannot render.
 */
export const isOutdatedNativeClient = (
  client: NativeClient | null,
  minimum: string,
): boolean => client !== null && compareVersions(client.version, minimum) < 0;
