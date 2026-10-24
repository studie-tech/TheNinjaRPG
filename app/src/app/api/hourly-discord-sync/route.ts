import { handleEndpointError, lockWithHourlyTimer } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { isDiscordLinkingEnabled } from "@/server/utils/discord/config";
import { reconcileDiscordLinks } from "@/server/utils/discord/sync";

const ENDPOINT_NAME = "hourly-discord-sync";

export const maxDuration = 300;

/**
 * Re-apply Discord nicknames, roles, bans and Linked Roles metadata for links whose stored
 * Discord state no longer matches the character (see `server/utils/discord/sync.ts`).
 */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  if (!isDiscordLinkingEnabled()) return Response.json({ skipped: true });

  const timer = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timer.isNewHour) return timer.response;

  try {
    return Response.json(await reconcileDiscordLinks(drizzleDB));
  } catch (cause) {
    try {
      // Invoked every ten minutes; release the hour so the next invocation retries.
      await timer.release();
    } catch (rollbackCause) {
      console.error("Failed to restore Discord sync timer", rollbackCause);
    }
    return handleEndpointError(cause, { endpoint: `/api/${ENDPOINT_NAME}` });
  }
}
