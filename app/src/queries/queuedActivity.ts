import { and, eq, notInArray } from "drizzle-orm";
import {
  caravanParticipant,
  dungeonMember,
  dungeonRun,
  mpvpBattleUser,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the lookup of a player's battle lobby seat; a null lobby is an orphaned seat. */
export const findQueuedBattleSeat = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.mpvpBattleUser.findFirst({
    columns: { clanBattleId: true },
    where: eq(mpvpBattleUser.userId, userId),
    with: { clanBattle: { columns: { battleType: true, sector: true } } },
  });

/** Build the lookup of the live dungeon party that holds a player. */
export const selectQueuedDungeon = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ runId: dungeonRun.id })
    .from(dungeonMember)
    .innerJoin(dungeonRun, eq(dungeonRun.id, dungeonMember.runId))
    .where(
      and(
        eq(dungeonMember.activeUserId, userId),
        notInArray(dungeonRun.status, ["COMPLETED", "ENDED"]),
      ),
    )
    .limit(1);

/** Build the lookup of the caravan a player escorts. */
export const selectQueuedEscort = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ caravanId: caravanParticipant.caravanId })
    .from(caravanParticipant)
    .where(
      and(
        eq(caravanParticipant.activeUserId, userId),
        eq(caravanParticipant.role, "GUARD"),
      ),
    )
    .limit(1);
