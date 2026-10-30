import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Raw regeneration sources for membership and event boost projections. */
export const findMembershipUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: {
      clan: true,
      bloodline: true,
      raidBuffs: true,
      titles: true,
      village: {
        with: {
          structures: true,
        },
      },
    },
  });

/** Read scheduled boosts and their token balance in one relation query. */
export const findVillageBoostUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { villageId: true },
    with: {
      village: { columns: { id: true, tokens: true, shrineSettings: true } },
    },
  });
