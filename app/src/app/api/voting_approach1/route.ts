import { handleEndpointError } from "@/libs/gamesettings";
import { updateUserVoteForHandleVote } from "@/queries/profile";
import { drizzleDB } from "@/server/db";

export async function POST(request: Request) {
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
  // https://www.top100arena.com/listing/101116/vote?incentive=testSecret-top100arena
  // https://mmohub.com/site/1054/vote/testSecret-mmohub
  // https://www.arena-top100.com/index.php?a=in&u=Terriator&incentive=testSecret-arenaTop100
  // https://www.xtremetop100.com/in.php?site=1132291230&secret=testSecret&siteid=xtremeTop100
  // https://browsermmorpg.com/vote.php?id=925&incentive=testSecret-browserMmorpg

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

  await updateUserVoteForHandleVote(drizzleDB, siteId, now, secret);
}
