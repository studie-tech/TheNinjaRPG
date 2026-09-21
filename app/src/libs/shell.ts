import type { AbVariant } from "@/hooks/useAbVariant";
import {
  AB_PIXEL_LAYOUT_COOKIE,
  cookieValueToLayout,
  type EffectiveLayout,
  LAYOUT_PREFERENCE_COOKIE,
  LEGACY_AB_LAYOUT_COOKIE,
} from "@/libs/layoutPreference";
import { parseNativeUserAgent } from "@/libs/native/userAgent";

/**
 * The application shell is prerendered once per variant and served from the CDN.
 *
 * Every page lives under app/[shell], and the proxy rewrites each request to the variant
 * that matches it, so the root layout never reads the request: nothing in a document is
 * specific to the visitor, and a copy rendered for one can be served to the next. A
 * variant is the set of things that change the markup before hydration -- whether the
 * frame is the signed-in one, which layout family it uses, and which client it is for,
 * as the native shells load Clerk through a proxy and Android takes a different
 * viewport. Everything the visitor actually sees arrives through tRPC after hydration.
 */
export interface ShellVariant {
  client: "web" | "ios" | "android";
  layout: EffectiveLayout;
  signedIn: boolean;
}

export const SHELL_CLIENTS = ["web", "ios", "android"] as const;
export const SHELL_LAYOUTS = [
  "default",
  "pixel",
] as const satisfies readonly EffectiveLayout[];

/** The URL segment a variant renders under, e.g. "web-pixel-in". */
export const shellParam = ({ client, layout, signedIn }: ShellVariant) =>
  `${client}-${layout}-${signedIn ? "in" : "out"}`;

/** Inverse of shellParam; null for anything that is not a known variant. */
export const parseShellParam = (param: string): ShellVariant | null => {
  const [client, layout, session, ...rest] = param.split("-");
  if (rest.length > 0) return null;
  if (!SHELL_CLIENTS.includes(client as ShellVariant["client"])) return null;
  if (!SHELL_LAYOUTS.includes(layout as EffectiveLayout)) return null;
  if (session !== "in" && session !== "out") return null;
  return {
    client: client as ShellVariant["client"],
    layout: layout as EffectiveLayout,
    signedIn: session === "in",
  };
};

/**
 * Every variant, all built at deploy time. The segment is closed to anything else (the
 * layout sets dynamicParams to false), so a value that is not one of these is a static
 * 404 rather than a render.
 */
export const SHELL_PARAMS = SHELL_CLIENTS.flatMap((client) =>
  SHELL_LAYOUTS.flatMap((layout) =>
    [false, true].map((signedIn) => shellParam({ client, layout, signedIn })),
  ),
);

const SHELL_PARAM_PATTERN = new RegExp(
  `^/(?:${SHELL_CLIENTS.join("|")})-(?:${SHELL_LAYOUTS.join("|")})-(?:in|out)(?=/|$)`,
);

/**
 * The public path a variant path stands for, or null when the path is not one. Variant
 * paths are an implementation detail of the rewrite; a request that names one directly
 * is sent back to the public path so the segment never appears in a URL bar or a link.
 * Whatever follows the segment is made a plain absolute path first, so a remainder such
 * as //host cannot turn the redirect into one that leaves the site.
 */
export const publicPathForShellPath = (pathname: string): string | null => {
  const match = SHELL_PARAM_PATTERN.exec(pathname);
  if (!match) return null;
  const rest = pathname.slice(match[0].length).replace(/^[/\\]+/, "");
  return `/${rest}`;
};

/** What the proxy knows about a request, in a form a test can build by hand. */
export interface ShellRequest {
  userAgent: string | null;
  pathname: string;
  /** The user id Clerk verified for this request, if any. */
  userId: string | null;
  cookies: ReadonlyMap<string, string>;
  /** Draws an experiment assignment for a visitor who has none. */
  draw: () => AbVariant;
}

export interface ShellChoice {
  variant: ShellVariant;
  /** Experiment assignments drawn for this visit, to be set on the response. */
  assigned: Partial<Record<string, AbVariant>>;
}

/**
 * Search engines and social preview services discard cookies between fetches, so the
 * random landing-page assignment would hand them a different variant -- different
 * headings, copy and hero asset -- on every crawl of the site's highest-value URL.
 * Anything matching here is pinned to the default layout instead, which renders the
 * long-form section copy (Jutsus, Combat, Village, Sectors, Travel), roughly twice the
 * indexable text of the pixel variant. Both are variants real visitors receive, so this
 * is an A/B split rather than crawler-specific content. Note that Welcome.tsx hides that
 * copy when NEXT_PUBLIC_MCP_ENABLED is set, so enabling MCP in production would leave
 * crawlers on a near-empty landing page and this choice should be revisited.
 */
const CRAWLER_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|mediapartners|facebookexternalhit|bingpreview|whatsapp|telegram|embedly|quora link preview|pinterest|vkshare|w3c_validator|lighthouse|chrome-lighthouse/i;

/**
 * Whether the browser holds a Clerk session, judged from the cookies Clerk keeps rather
 * than from verifying the token. The signed-in frame is a presentational hint that the
 * client corrects once Clerk loads, and this is the same marker clerk-js reads to know
 * a session exists before it has loaded: __client_uat is a timestamp while signed in and
 * "0" after sign-out, and it outlives a session token that has merely expired. Choosing
 * the frame from the token instead would flip the whole shell -- and remount everything
 * under it -- on any request where a token is stale but about to be refreshed.
 */
const clientHasSession = (cookies: ReadonlyMap<string, string>) => {
  for (const [name, value] of cookies) {
    if (name.startsWith("__client_uat") && value !== "" && value !== "0") return true;
    if (name.startsWith("__session")) return true;
  }
  return false;
};

/**
 * The variant a request is served, and any experiment assignment drawn for it.
 *
 * A crawler is pinned to the signed-out default layout; a person whose browser string
 * happens to match the crawler pattern is told apart by their session cookies. Everyone
 * else gets the layout their cookies ask for, an explicit preference beating the
 * experiment assignment, and a signed-out visitor arriving on the landing page without an
 * assignment is given one here so this very document and the cookie agree.
 */
export const chooseShell = (request: ShellRequest): ShellChoice => {
  const native = parseNativeUserAgent(request.userAgent);
  const client: ShellVariant["client"] = native ? native.platform : "web";
  const hasSession = request.userId !== null || clientHasSession(request.cookies);
  if (!hasSession && request.userAgent && CRAWLER_USER_AGENT.test(request.userAgent)) {
    return { variant: { client, layout: "default", signedIn: false }, assigned: {} };
  }
  const assigned: ShellChoice["assigned"] = {};
  const isLandingVisit = !hasSession && request.pathname === "/";
  const assignment = (cookie: string) => {
    const existing = request.cookies.get(cookie);
    if (existing !== undefined || !isLandingVisit) return existing;
    const drawn = request.draw();
    assigned[cookie] = drawn;
    return drawn;
  };
  // The legacy experiment is still assigned so the tRPC context keeps stamping it, but
  // it no longer decides the layout.
  assignment(LEGACY_AB_LAYOUT_COOKIE);
  const pixel = assignment(AB_PIXEL_LAYOUT_COOKIE);
  const layout =
    cookieValueToLayout(request.cookies.get(LAYOUT_PREFERENCE_COOKIE)) ??
    cookieValueToLayout(pixel) ??
    "default";
  return { variant: { client, layout, signedIn: hasSession }, assigned };
};
