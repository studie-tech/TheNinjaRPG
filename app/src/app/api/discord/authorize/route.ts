import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { userData } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { getDiscordConfig } from "@/server/utils/discord/config";
import { buildAuthorizeUrl } from "@/server/utils/discord/rest";
import {
  createLinkState,
  LINK_STATE_COOKIE,
  LINK_STATE_TTL_MS,
} from "@/server/utils/discord/secrets";

/**
 * Start Discord linking: bind a signed OAuth state to the signed-in character and this
 * browser, then send the player to Discord's consent screen. OAuth needs a redirect with a
 * cookie, which a tRPC call cannot provide.
 */
export async function GET(request: Request) {
  const resultUrl = (result: string) =>
    new URL(`/discord/link?result=${result}`, request.url);
  const config = getDiscordConfig();
  if (!config) return NextResponse.redirect(resultUrl("disabled"));
  const { userId } = await auth();
  if (!userId)
    return NextResponse.redirect(
      new URL(
        `/login?redirect_url=${encodeURIComponent("/discord/link")}`,
        request.url,
      ),
    );
  const character = await drizzleDB.query.userData.findFirst({
    columns: { userId: true },
    where: eq(userData.userId, userId),
  });
  if (!character) return NextResponse.redirect(resultUrl("no_character"));
  const { state, nonce } = createLinkState(userId, config.clientSecret);
  const response = NextResponse.redirect(buildAuthorizeUrl(config, state));
  response.cookies.set(LINK_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/discord",
    maxAge: LINK_STATE_TTL_MS / 1000,
  });
  return response;
}
