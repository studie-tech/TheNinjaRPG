import type { Item, Jutsu, RankedLoadout } from "@/drizzle/schema";
import { listItemsByIds } from "@/queries/item";
import { listJutsuByIds } from "@/queries/jutsu";
import {
  findRankedLoadoutForCleanRankedProhibitedSelections,
  listUserDataForFetchSanninRankedPlayers,
  updateRankedLoadoutForCleanRankedProhibitedSelections,
} from "@/queries/pvprank";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/utils/time";

const RANKED_LOADOUT_CLEANUP_MAX_ATTEMPTS = 3;

/**
 * LP values of the top Legend players. Sannin is the top
 * RANKED_SANNIN_TOP_PLAYERS players who have reached Legend (900+ LP).
 */
export const fetchSanninRankedPlayers = async (client: DrizzleClient) => {
  const users = await listUserDataForFetchSanninRankedPlayers(client);
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
      ? listJutsuByIds(client, referencedJutsuIds)
      : Promise.resolve([]),
    referencedItemIds.length > 0
      ? listItemsByIds(client, referencedItemIds)
      : Promise.resolve([]),
  ]);
  // Deleted jutsu and items missing from the shop can never pass
  // updateRankedLoadout, so they are stripped alongside prohibited selections.
  const foundJutsuIds = new Set(selectedJutsus.map((entry) => entry.id));
  const foundItemIds = new Set(selectedItems.map((entry) => entry.id));
  const removedJutsuIds = [
    ...selectedJutsus
      .filter(
        (entry) =>
          entry.requiredSkillId || entry.battleUsageType === "PVE" || !!entry.villageId,
      )
      .map((entry) => entry.id),
    ...referencedJutsuIds.filter((id) => !foundJutsuIds.has(id)),
  ];
  const removedItemIds = [
    ...selectedItems
      .filter((entry) => entry.requiredSkillId || entry.bloodlineId || !entry.inShop)
      .map((entry) => entry.id),
    ...referencedItemIds.filter((id) => !foundItemIds.has(id)),
  ];
  const keep = (ids: string[] = [], removed: string[]) => [
    ...new Set(ids.filter((id) => !removed.includes(id))),
  ];
  const cleanedLoadout = {
    ...storedLoadout.loadout,
    jutsuIds: keep(storedLoadout.loadout.jutsuIds, removedJutsuIds),
    favoriteJutsuIds: keep(storedLoadout.loadout.favoriteJutsuIds, removedJutsuIds),
    weaponIds: keep(storedLoadout.loadout.weaponIds, removedItemIds),
    consumableIds: keep(storedLoadout.loadout.consumableIds, removedItemIds),
    favoriteWeaponIds: keep(storedLoadout.loadout.favoriteWeaponIds, removedItemIds),
    favoriteConsumableIds: keep(
      storedLoadout.loadout.favoriteConsumableIds,
      removedItemIds,
    ),
  };
  // Duplicate ids change the loadout without being reported as removals.
  const hasChanges = (
    [
      "jutsuIds",
      "favoriteJutsuIds",
      "weaponIds",
      "consumableIds",
      "favoriteWeaponIds",
      "favoriteConsumableIds",
    ] as const
  ).some(
    (key) => (storedLoadout.loadout[key] ?? []).length !== cleanedLoadout[key].length,
  );
  const loadout = hasChanges
    ? { ...storedLoadout, loadout: cleanedLoadout }
    : storedLoadout;
  return {
    loadout,
    hasChanges,
    removedJutsuIds,
    removedItemIds,
    // Favorites remain stored; only equipped rows contribute to loadout limits.
    jutsus: selectedJutsus.filter((entry) =>
      loadout.loadout.jutsuIds.includes(entry.id),
    ),
    items: selectedItems.filter(
      (entry) =>
        loadout.loadout.weaponIds.includes(entry.id) ||
        loadout.loadout.consumableIds.includes(entry.id),
    ),
  };
};

/**
 * Strip selections ranked validation rejects: skill-gated jutsu/items,
 * PVE-only jutsu, village-gated jutsu, bloodline-bound items, deleted jutsu,
 * deleted or no-longer-in-shop items, and duplicate ids. Kept in sync
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
  hasChanges: boolean;
  removedJutsuIds: string[];
  removedItemIds: string[];
  jutsus: Jutsu[];
  items: Item[];
}> => {
  const filtered = await filterProhibitedRankedSelections(client, storedLoadout);
  if (!filtered.hasChanges) {
    return filtered;
  }

  const nextUpdatedAt = getNextUserSnapshotAt(storedLoadout.updatedAt);
  const loadout: RankedLoadout = {
    ...filtered.loadout,
    updatedAt: nextUpdatedAt,
  };
  const result = await updateRankedLoadoutForCleanRankedProhibitedSelections(
    client,
    loadout,
    nextUpdatedAt,
    storedLoadout,
  );
  if (result.rowsAffected === 0) {
    const current = await findRankedLoadoutForCleanRankedProhibitedSelections(
      client,
      storedLoadout,
    );
    if (!current) {
      return { ...filtered, loadout };
    }
    if (attempt + 1 >= RANKED_LOADOUT_CLEANUP_MAX_ATTEMPTS) {
      // Give up persisting; still strip prohibited ids from the latest row for
      // this request so matchmaking cannot force them into battle.
      return filterProhibitedRankedSelections(client, current);
    }
    return cleanRankedProhibitedSelections(client, current, attempt + 1);
  }
  return { ...filtered, loadout };
};
