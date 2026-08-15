import { gte } from "drizzle-orm";
import {
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * LP values of the top Legend players. Sannin is the top
 * RANKED_SANNIN_TOP_PLAYERS players who have reached Legend (900+ LP).
 */
export const fetchSanninRankedPlayers = async (client: DrizzleClient) => {
  const users = await client.query.userData.findMany({
    columns: {
      userId: true,
      rankedLp: true,
    },
    orderBy: (userData, { desc }) => [desc(userData.rankedLp)],
    where: gte(userData.rankedLp, RANKED_LEGEND_LP_REQUIREMENT),
    limit: RANKED_SANNIN_TOP_PLAYERS,
  });
  return users.map((u) => u.rankedLp);
};
