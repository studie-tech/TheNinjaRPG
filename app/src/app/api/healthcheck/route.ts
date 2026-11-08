import { headers } from "next/headers";
import { findUserDataForGET } from "@/queries/profile";
import { drizzleDB } from "@/server/db";

/**
 * The native shells boot into a page served from the WebView's own origin and check this
 * endpoint before navigating to the site, so the request is cross-origin and needs a CORS
 * header to be readable. The allowlist covers every scheme Capacitor can be configured
 * with. The body is a constant "OK", so nothing is exposed by allowing the read.
 */
const SHELL_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

const corsHeaders = async (): Promise<Record<string, string>> => {
  const origin = (await headers()).get("origin");
  if (!origin || !SHELL_ORIGINS.has(origin)) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
};

/**
 * Answered so a preflight can never be what stops the native shell from launching. The
 * request the shell makes is a simple one and should not trigger this at all, but a shell
 * is expensive to fix once shipped and this costs nothing.
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...(await corsHeaders()),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Cache-Control, Pragma",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** Probe database reachability with a user lookup and preserve CORS headers on every response. */
export async function GET() {
  const cors = await corsHeaders();

  try {
    const user = await findUserDataForGET(drizzleDB);
    if (!user) return Response.json("User not found", { status: 404, headers: cors });
    return Response.json(`OK`, { headers: cors });
  } catch (cause) {
    console.error(cause);
    return Response.json("Internal server error", { status: 500, headers: cors });
  }
}
