import type { EffectiveLayout } from "@/libs/layoutPreference";

/**
 * The application shell is prerendered once per variant and served from the CDN.
 *
 * Every page lives under app/[shell], and the proxy rewrites each request to the variant
 * that matches it, so the root layout never reads the request: nothing in a document is
 * specific to the visitor, and a copy rendered for one can be served to the next. The
 * three things the layout used to read from the request are exactly the three that
 * change the markup before hydration -- whether the frame is the signed-in one, which
 * layout family it uses, and whether Clerk loads through the native proxy -- and each
 * is a dimension of the variant instead. Everything the visitor actually sees arrives
 * through tRPC after hydration, as it always did.
 *
 * The variant is decided at the edge from the same cookies and session the layout used
 * to read, so a visitor gets the same shell they always did; the render simply does not
 * happen per request any more.
 */
export interface ShellVariant {
  /** "native" only when the shell must load Clerk through the same-origin proxy. */
  client: "web" | "native";
  layout: EffectiveLayout;
  signedIn: boolean;
}

export const SHELL_CLIENTS = ["web", "native"] as const;
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
 * The variants built at deploy time. Native ones are left out: they only exist while
 * the Clerk proxy is enabled, and are rendered on first request and cached from then on,
 * which keeps them off the build without costing a native visitor anything after the
 * first.
 */
export const PRERENDERED_SHELL_PARAMS = SHELL_LAYOUTS.flatMap((layout) =>
  [false, true].map((signedIn) => shellParam({ client: "web", layout, signedIn })),
);

const SHELL_PARAM_PATTERN = /^\/(web|native)-(default|pixel)-(in|out)(?=\/|$)/;

/**
 * The public path a variant path stands for, or null when the path is not one. Variant
 * paths are an implementation detail of the rewrite; a request that names one directly
 * is sent back to the public path so the segment never appears in a URL bar or a link.
 */
export const publicPathForShellPath = (pathname: string): string | null => {
  const match = SHELL_PARAM_PATTERN.exec(pathname);
  if (!match) return null;
  return pathname.slice(match[0].length) || "/";
};
