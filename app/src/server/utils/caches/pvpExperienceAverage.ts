import { PVP_EXPERIENCE_AVERAGE_SETTING } from "@/drizzle/constants";
import type { GameSetting } from "@/drizzle/schema";
import { selectUserDataForLoadAverage } from "@/queries/pvprank";
import type { DrizzleClient } from "@/server/db";
import { scopedRead } from "@/server/requestScope";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// The average scans every human UserData row, while combat, travel, quests, profile and
// the user queue read it on almost every request, so every instance shares one value
// through the Runtime Cache. Between daily decays it moves only through PvP rewards: at
// most 472.5 XP per one-on-one battle (win and participation at the highest boost)
// spread over ~48k players, about 0.01 per battle, so even a peak hour of 30 battles shifts an
// average near 20 by about 1.5%. Ten minutes of staleness therefore stays well below
// the gaps between boost tiers. The daily decay moves it by 10% at once, so that cron
// invalidates the cache. Instances check the shared version once a minute, keeping
// Runtime Cache reads off the hot path.
const pvpExperienceAverage = createRuntimeCache({
  name: "pvp-experience-average",
  ttlSeconds: 10 * 60,
  memorySeconds: 60,
  cloneReads: false,
  /**
   * The (isAi, pvpExperience) index answers the average from the index alone. MySQL's
   * cost model discounts indexes by how much of them sits in the buffer pool, and a
   * query that runs only every few minutes leaves this index cold, so without the hint
   * the optimizer picks the hot single-column isAi index and then performs one primary
   * key lookup per human row (roughly ten times slower).
   */
  load: async (client: Pick<DrizzleClient, "select">) => {
    const computedAt = new Date();
    const [row] = await selectUserDataForLoadAverage(client);
    return { value: row?.average ?? 0, computedAt };
  },
});

/**
 * Average PvP experience of human players (AI templates excluded), as a game setting.
 *
 * Served from the Runtime Cache; concurrent misses for the same version on one
 * instance share a query, and a failed query is not cached. `scopedRead` shares the
 * result across the procedures of one tRPC batch.
 */
export const fetchPvpExperienceAverage = (
  client: Pick<DrizzleClient, "select">,
): Promise<GameSetting> =>
  scopedRead("pvpExperienceAverage", async () => {
    const { value, computedAt } = await pvpExperienceAverage.read(client);
    return {
      id: PVP_EXPERIENCE_AVERAGE_SETTING,
      name: PVP_EXPERIENCE_AVERAGE_SETTING,
      value,
      time: computedAt,
    };
  });

/** Make every instance compute the average again; call after the daily PvP XP decay. */
export const invalidatePvpExperienceAverage = pvpExperienceAverage.invalidate;
