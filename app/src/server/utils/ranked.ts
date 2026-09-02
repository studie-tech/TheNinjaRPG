import { eq, gte, inArray } from "drizzle-orm";
import {
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";
import type { RankedLoadout } from "@/drizzle/schema";
import { item, jutsu, rankedLoadout, userData } from "@/drizzle/schema";
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

/** Remove skill-gated jutsu and items from a stored ranked loadout. */
export const cleanRankedSkillRequirements = async (
  client: DrizzleClient,
  storedLoadout: RankedLoadout,
): Promise<{
  loadout: RankedLoadout;
  removedJutsuIds: string[];
  removedItemIds: string[];
}> => {
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
    .filter((entry) => entry.requiredSkillId)
    .map((entry) => entry.id);
  const removedItemIds = selectedItems
    .filter((entry) => entry.requiredSkillId)
    .map((entry) => entry.id);
  if (removedJutsuIds.length === 0 && removedItemIds.length === 0) {
    return { loadout: storedLoadout, removedJutsuIds, removedItemIds };
  }
  const loadout: RankedLoadout = {
    ...storedLoadout,
    updatedAt: new Date(),
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
  await client
    .update(rankedLoadout)
    .set({ loadout: loadout.loadout, updatedAt: loadout.updatedAt })
    .where(eq(rankedLoadout.id, storedLoadout.id));
  return { loadout, removedJutsuIds, removedItemIds };
};
