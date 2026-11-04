import { handleEndpointError } from "@/libs/gamesettings";
import { updateUserVoteForHandleVote } from "@/queries/profile";
import { drizzleDB } from "@/server/db";

export async function POST(request: Request) {
  // https://topwebgames.com/game/theninja-rpg-core4/vote?incentive=testSecret-topwebgames&test=true&alwaysReward=true

  try {
    const { searchParams } = new URL(request.url);
    const data = await request.formData();
    const incentive =
      (data.get("incentive") as string) ||
      (data.get("uid") as string) ||
      queryIncentive(searchParams);
    const [secret, siteId] = incentive.split("-");

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
  // https://mmohub.com/site/1054/vote/testSecret-mmohub
  // https://www.arena-top100.com/index.php?a=in&u=Terriator&incentive=testSecret-arenaTop100

  try {
    // For getting search params
    const { searchParams } = new URL(request.url);
    const incentive = queryIncentive(searchParams);
    let [secret, siteId] = incentive.split("-");

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

/** The `secret-siteId` incentive from the query-string aliases the vote sites use. */
const queryIncentive = (searchParams: URLSearchParams) =>
  searchParams.get("incentive") ||
  searchParams.get("param") ||
  searchParams.get("userid") ||
  "";

async function handleVote(secret: string, siteId: string) {
  const now = new Date();

  await updateUserVoteForHandleVote(drizzleDB, siteId, now, secret);
}
