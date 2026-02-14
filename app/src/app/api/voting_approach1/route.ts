import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { userVote } from "@/drizzle/schema";
import { handleEndpointError } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";

export async function POST(request: Request) {
  await cookies();

  // https://topwebgames.com/game/theninja-rpg-core4/vote?incentive=testSecret-topwebgames&test=true&alwaysReward=true
  // https://apexwebgaming.net/details/theninja-rpg-core4/vote?incentive=testSecret-apexWebGaming&test=true&alwaysReward=true

  try {
    const { searchParams } = new URL(request.url);
    const data = await request.formData();
    const incentive =
      (data.get("incentive") as string) ||
      (data.get("uid") as string) ||
      searchParams.get("incentive") ||
      searchParams.get("param") ||
      searchParams.get("userid");
    const [secret, siteId] = incentive?.split("-") ?? [];

    if (!secret || !siteId) {
      return Response.json(`Invalid incentive: ${incentive}`, { status: 400 });
    }

    await handleVote(secret, siteId);
    return Response.json(`OK: ${secret} ${siteId}`);
  } catch (cause) {
    return await handleEndpointError(cause);
  }
}

export async function GET(request: Request) {
  await cookies();

  // https://www.top100arena.com/listing/101116/vote?incentive=testSecret-top100arena
  // https://mmohub.com/site/1054/vote/testSecret-mmohub
  // https://www.arena-top100.com/index.php?a=in&u=Terriator&incentive=testSecret-arenaTop100
  // https://www.xtremetop100.com/in.php?site=1132291230&secret=testSecret&siteid=xtremeTop100
  // https://browsermmorpg.com/vote.php?id=925&incentive=testSecret-browserMmorpg
  // https://bbogd.com/vote/the-ninja-rpg/testSecret-bbogd

  try {
    // For getting search params
    const { searchParams } = new URL(request.url);
    const incentive =
      searchParams.get("incentive") ||
      searchParams.get("param") ||
      searchParams.get("userid") ||
      "";
    let [secret, siteId] = incentive?.split("-") ?? [];

    // Sometimes the secret and siteid are in the url
    if (!secret || !siteId) {
      secret = searchParams.get("secret") || "";
      siteId = searchParams.get("siteid") || "";
    }

    if (!secret || !siteId) {
      return Response.json(`Invalid incentive: ${incentive}`, { status: 400 });
    }

    await handleVote(secret, siteId);
    return Response.json(`OK: ${secret} ${siteId}`);
  } catch (cause) {
    return await handleEndpointError(cause);
  }
}

async function handleVote(secret: string, siteId: string) {
  const now = new Date();

  // First try to find existing vote record
  const existingVote = await drizzleDB.query.userVote.findFirst({
    where: and(eq(userVote.secret, secret)),
  });

  if (existingVote) {
    // Update existing record
    await drizzleDB
      .update(userVote)
      .set({
        ...(siteId === "topWebGames" ? { topWebGames: true } : {}), // in review
        ...(siteId === "top100arena" ? { top100Arena: true } : {}),
        ...(siteId === "mmohub" ? { mmoHub: true } : {}),
        ...(siteId === "arenaTop100" ? { arenaTop100: true } : {}),
        ...(siteId === "bbogd" ? { bbogd: true } : {}),
        ...(siteId === "xtremeTop100" ? { xtremeTop100: true } : {}), // No postbacks received
        ...(siteId === "topOnlineMmorpg" ? { topOnlineMmorpg: true } : {}), // Cannot register
        ...(siteId === "browserMmorpg" ? { browserMmorpg: true } : {}), // Pending approval?
        ...(siteId === "apexWebGaming" ? { apexWebGaming: true } : {}), // in review
        lastVoteAt: now,
      })
      .where(eq(userVote.secret, secret));
  }
}
