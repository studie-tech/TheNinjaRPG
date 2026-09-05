import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { cookies, headers } from "next/headers";
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

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  const cors = await corsHeaders();

  try {
    const user = await drizzleDB.query.userData.findFirst({
      columns: { username: true },
    });
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    return Response.json(`OK`, { headers: cors });
  } catch (cause) {
    console.error(cause);
    if (cause instanceof TRPCError) {
      // An error from tRPC occured
      const httpCode = getHTTPStatusCodeFromError(cause);
      return Response.json(cause, { status: httpCode, headers: cors });
    }
    // Another error occured
    return Response.json("Internal server error", { status: 500, headers: cors });
  }
}
