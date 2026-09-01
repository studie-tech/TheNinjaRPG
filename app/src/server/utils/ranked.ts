import { and, eq, gte, inArray } from "drizzle-orm";
import {
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";
import type { RankedLoadout } from "@/drizzle/schema";
import { item, jutsu, rankedLoadout, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";

const RANKED_LOADOUT_CLEANUP_MAX_ATTEMPTS = 3;

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

const filterProhibitedRankedSelections = async (
  client: DrizzleClient,
  storedLoadout: RankedLoadout,
) => {
  const referencedJutsuIds = [
    ...new Set([
      ...storedLoadout.loadout.jutsuIds,
      ...(storedLoadout.loadout.favoriteJutsuIds ?? []),
    ]),
  ];
  const referencedItemIds = [
    ...new Set([
      ...storedLoadout.loadout.weaponIds,
      ...storedLoadout.loadout.consumableIds,
      ...(storedLoadout.loadout.favoriteWeaponIds ?? []),
      ...(storedLoadout.loadout.favoriteConsumableIds ?? []),
    ]),
  ];
  const [selectedJutsus, selectedItems] = await Promise.all([
    referencedJutsuIds.length > 0
      ? client.query.jutsu.findMany({
          where: inArray(jutsu.id, referencedJutsuIds),
        })
      : Promise.resolve([]),
    referencedItemIds.length > 0
      ? client.query.item.findMany({ where: inArray(item.id, referencedItemIds) })
      : Promise.resolve([]),
  ]);
  const removedJutsuIds = selectedJutsus
    .filter(
      (entry) =>
        entry.requiredSkillId || entry.battleUsageType === "PVE" || !!entry.villageId,
    )
    .map((entry) => entry.id);
  const removedItemIds = selectedItems
    .filter((entry) => entry.requiredSkillId || entry.bloodlineId)
    .map((entry) => entry.id);
  if (removedJutsuIds.length === 0 && removedItemIds.length === 0) {
    return { loadout: storedLoadout, removedJutsuIds, removedItemIds };
  }
  const loadout: RankedLoadout = {
    ...storedLoadout,
    loadout: {
      ...storedLoadout.loadout,
      jutsuIds: storedLoadout.loadout.jutsuIds.filter(
        (id) => !removedJutsuIds.includes(id),
      ),
      favoriteJutsuIds: (storedLoadout.loadout.favoriteJutsuIds ?? []).filter(
        (id) => !removedJutsuIds.includes(id),
      ),
      weaponIds: storedLoadout.loadout.weaponIds.filter(
        (id) => !removedItemIds.includes(id),
      ),
      consumableIds: storedLoadout.loadout.consumableIds.filter(
        (id) => !removedItemIds.includes(id),
      ),
      favoriteWeaponIds: (storedLoadout.loadout.favoriteWeaponIds ?? []).filter(
        (id) => !removedItemIds.includes(id),
      ),
      favoriteConsumableIds: (storedLoadout.loadout.favoriteConsumableIds ?? []).filter(
        (id) => !removedItemIds.includes(id),
      ),
    },
  };
  return { loadout, removedJutsuIds, removedItemIds };
};

/**
 * Strip selections ranked validation rejects: skill-gated jutsu/items,
 * PVE-only jutsu, village-gated jutsu, and bloodline-bound items. Kept in sync
 * with validateJutsuLoadout / validateItemLoadout so matchmaking cannot force
 * a pre-restriction loadout into battle.
 *
 * Writes use optimistic concurrency on `updatedAt`. If another request (e.g.
 * updateRankedLoadout) wins the race, reload the current row and retry cleanup
 * so a stale filtered snapshot cannot overwrite newer valid selections.
 */
export const cleanRankedProhibitedSelections = async (
  client: DrizzleClient,
  storedLoadout: RankedLoadout,
  attempt = 0,
): Promise<{
  loadout: RankedLoadout;
  removedJutsuIds: string[];
  removedItemIds: string[];
}> => {
  const filtered = await filterProhibitedRankedSelections(client, storedLoadout);
  if (filtered.removedJutsuIds.length === 0 && filtered.removedItemIds.length === 0) {
    return filtered;
  }

  const nextUpdatedAt = getNextUserSnapshotAt(storedLoadout.updatedAt);
  const loadout: RankedLoadout = {
    ...filtered.loadout,
    updatedAt: nextUpdatedAt,
  };
  const result = await client
    .update(rankedLoadout)
    .set({ loadout: loadout.loadout, updatedAt: nextUpdatedAt })
    .where(
      and(
        eq(rankedLoadout.id, storedLoadout.id),
        eq(rankedLoadout.updatedAt, storedLoadout.updatedAt),
      ),
    );
  if (result.rowsAffected === 0) {
    const current = await client.query.rankedLoadout.findFirst({
      where: eq(rankedLoadout.id, storedLoadout.id),
    });
    if (!current) {
      return {
        loadout,
        removedJutsuIds: filtered.removedJutsuIds,
        removedItemIds: filtered.removedItemIds,
      };
    }
    if (attempt + 1 >= RANKED_LOADOUT_CLEANUP_MAX_ATTEMPTS) {
      // Give up persisting; still strip prohibited ids from the latest row for
      // this request so matchmaking cannot force them into battle.
      return filterProhibitedRankedSelections(client, current);
    }
    return cleanRankedProhibitedSelections(client, current, attempt + 1);
  }
  return {
    loadout,
    removedJutsuIds: filtered.removedJutsuIds,
    removedItemIds: filtered.removedItemIds,
  };
};
