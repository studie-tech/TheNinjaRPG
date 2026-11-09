import {
  GAME_LAYOUTS,
  type GameLayoutId,
  getWelcomeLayout,
  toGameLayoutId,
} from "@/libs/gameLayouts";
import { LAYOUT_PREFERENCE_COOKIE } from "@/libs/layoutPreference";
import {
  LEMU_EXPERIMENT,
  type LemuVariant,
  normalizeLemuVariant,
} from "@/libs/lemuExperiment";
import { parseNativeUserAgent } from "@/libs/native/userAgent";
import {
  parseWallpaperVariant,
  WALLPAPER_EXPERIMENT,
  WALLPAPER_VARIANTS,
  type WallpaperVariant,
} from "@/libs/wallpaperExperiment";

/**
 * The application shell is prerendered once per variant and served from the CDN.
 *
 * Every page lives under app/[shell], and the proxy rewrites each request to the variant
 * that matches it, so the root layout never reads the request: nothing in a document is
 * specific to the visitor, and a copy rendered for one can be served to the next. A
 * variant is the set of things that change the markup before hydration -- whether the
 * frame is the signed-in one, which layout it uses, which wallpaper it shows, and which
 * client it is for, as the native shells load Clerk through a proxy and Android takes a
 * different viewport. Everything the visitor actually sees arrives through tRPC after
 * hydration.
 */
export interface ShellVariant {
  client: "web" | "ios" | "android";
  layout: GameLayoutId;
  signedIn: boolean;
  wallpaper?: WallpaperVariant;
}

export const SHELL_CLIENTS = ["web", "ios", "android"] as const;
export const SHELL_LAYOUTS = GAME_LAYOUTS.map((layout) => layout.id);

/** A variant segment, capturing its client, layout, session and optional wallpaper. */
const SHELL_SEGMENT = `(${SHELL_CLIENTS.join("|")})-(${SHELL_LAYOUTS.join("|")})-(in|out)(?:-(${WALLPAPER_VARIANTS.join("|")}))?`;
const SHELL_PARAM_REGEX = new RegExp(`^${SHELL_SEGMENT}$`);

/** The URL segment a variant renders under, e.g. "web-pixel-in". */
export const shellParam = ({ client, layout, signedIn, wallpaper }: ShellVariant) =>
  `${client}-${layout}-${signedIn ? "in" : "out"}${wallpaper ? `-${wallpaper}` : ""}`;

/** Inverse of shellParam; null for anything that is not a known variant. */
export const parseShellParam = (param: string): ShellVariant | null => {
  const match = SHELL_PARAM_REGEX.exec(param);
  if (!match) return null;
  const [, client, layout, session, wallpaper] = match;
  if (wallpaper && (client !== "web" || layout !== "default" || session !== "out"))
    return null;

  return {
    client: client as ShellVariant["client"],
    layout: layout as GameLayoutId,
    signedIn: session === "in",
    ...(wallpaper ? { wallpaper: parseWallpaperVariant(wallpaper) } : {}),
  };
};

/** Variants without a wallpaper arm. */
const BASE_SHELL_PARAMS = SHELL_CLIENTS.flatMap((client) =>
  SHELL_LAYOUTS.flatMap((layout) =>
    [false, true].map((signedIn) => shellParam({ client, layout, signedIn })),
  ),
);

/**
 * Every variant, for generateStaticParams. Wallpaper arms exist only for the signed-out
 * web Classic shell.
 */
export const SHELL_PARAMS = [
  ...BASE_SHELL_PARAMS,
  ...WALLPAPER_VARIANTS.map((wallpaper) =>
    shellParam({ client: "web", layout: "default", signedIn: false, wallpaper }),
  ),
];

const SHELL_PATH_PATTERN = new RegExp(`^/${SHELL_SEGMENT}(?=/|$)`);

/**
 * The public path a variant path stands for, or null when the path is not one. Variant
 * paths are an implementation detail of the rewrite; a request that names one directly
 * is sent back to the public path so the segment never appears in a URL bar or a link.
 * Whatever follows the segment is made a plain absolute path first, so a remainder such
 * as //host cannot turn the redirect into one that leaves the site.
 */
export const publicPathForShellPath = (pathname: string): string | null => {
  const match = SHELL_PATH_PATTERN.exec(pathname);
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
  draw: () => LemuVariant;
  drawWallpaper: () => WallpaperVariant;
  /** Only a document visit can enroll a new visitor, never prefetch or RSC navigation. */
  isDocument?: boolean;
}

export interface ShellChoice {
  variant: ShellVariant;
  /** Experiment assignments drawn for this visit, to be set on the response. */
  assigned: Record<string, string>;
}

/**
 * Search engines and social preview services discard cookies between fetches, so a
 * request matching here is never treated as a landing visit that draws experiment
 * assignments, and always receives the signed-out default shell.
 */
const CRAWLER_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|mediapartners|facebookexternalhit|bingpreview|whatsapp|telegram|embedly|quora link preview|pinterest|vkshare|w3c_validator|lighthouse|chrome-lighthouse/i;

/**
 * Whether the browser holds a Clerk session, read from the marker clerk-js itself reads
 * before it has loaded: __client_uat is a timestamp while signed in, "0" after sign-out,
 * and it outlives a session token that has merely expired. The frame is a presentational
 * hint the client corrects once Clerk loads; deciding it from the token instead flips the
 * whole shell, and remounts everything under it, on any request with a stale token.
 */
const clientHasSession = (cookies: ReadonlyMap<string, string>) => {
  for (const [name, value] of cookies) {
    if (name.startsWith("__client_uat") && value !== "" && value !== "0") return true;
  }
  return false;
};

/**
 * The variant a request is served, and any experiment assignment drawn for it.
 *
 * Layout preferences apply both in game and on public pages. Visitors without a choice
 * receive the site's welcome default; signed-in players without a choice receive Classic.
 * Crawlers always receive the default. A person whose browser string happens to match the
 * crawler pattern is told apart by their session cookies. A signed-out visitor arriving on
 * the landing page without assignments for the Lemu and wallpaper experiments is given them
 * here so the document and the cookie agree.
 */
export const chooseShell = (
  request: ShellRequest,
  welcomeLayout: unknown = process.env.NEXT_PUBLIC_WELCOME_LAYOUT,
): ShellChoice => {
  const native = parseNativeUserAgent(request.userAgent);
  const client: ShellVariant["client"] = native ? native.platform : "web";
  const hasSession = request.userId !== null || clientHasSession(request.cookies);
  if (!hasSession && request.userAgent && CRAWLER_USER_AGENT.test(request.userAgent)) {
    return { variant: { client, layout: "default", signedIn: false }, assigned: {} };
  }
  const preference = toGameLayoutId(request.cookies.get(LAYOUT_PREFERENCE_COOKIE));
  const layout =
    preference ?? (!hasSession ? getWelcomeLayout(welcomeLayout) : "default");
  const assigned: ShellChoice["assigned"] = {};
  const isLandingVisit =
    !hasSession &&
    layout === "default" &&
    request.pathname === "/" &&
    request.isDocument !== false;
  if (isLandingVisit && !normalizeLemuVariant(request.cookies.get(LEMU_EXPERIMENT))) {
    assigned[LEMU_EXPERIMENT] = request.draw();
  }
  let wallpaper = parseWallpaperVariant(request.cookies.get(WALLPAPER_EXPERIMENT));
  if (client === "web" && isLandingVisit && !wallpaper) {
    wallpaper = request.drawWallpaper();
    assigned[WALLPAPER_EXPERIMENT] = wallpaper;
  }
  return {
    variant: {
      client,
      layout,
      signedIn: hasSession,
      ...(!hasSession && layout === "default" && client === "web" && wallpaper
        ? { wallpaper }
        : {}),
    },
    assigned,
  };
};
