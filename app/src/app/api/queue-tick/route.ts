import { cookies } from "next/headers";
import { handleEndpointError, lockWithMinuteTimer } from "@/libs/gamesettings";
import { processActivityQueueTick } from "@/libs/queue";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "queue-tick";

export async function GET() {
  await cookies();

  const minuteCheck = await lockWithMinuteTimer(drizzleDB, ENDPOINT_NAME);
  if (!minuteCheck.isNewMinute && minuteCheck.response) return minuteCheck.response;

  try {
    const result = await processActivityQueueTick(drizzleDB);
    return new Response(
      `Queue tick: ${result.statCompleted} stats completed, ${result.jutsuPromoted} jutsu promoted, ${result.craftPromoted} crafts promoted, ${result.terminalPurged} terminal rows purged`,
      { status: 200 },
    );
  } catch (cause) {
    return await handleEndpointError(cause);
  }
}
