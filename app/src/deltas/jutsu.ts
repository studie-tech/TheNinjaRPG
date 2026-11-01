import type { UserQueueState } from "@/deltas/profile";
import { hasEnergyQueue } from "@/libs/queue";
import type { UserJutsuFilteringSchema } from "@/validators/jutsu";

import type { UserCachePatch } from "@/validators/userCache";

/** Debit reputation when required by a level transfer; queued energy work withholds the delta. */
export const getTransferLevelUserUpdate = ({
  user,
  needsReputation,
  transferCost,
}: {
  user: UserQueueState;
  needsReputation: boolean;
  transferCost: number;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: needsReputation ? -transferCost : 0 },
});

/** Combine confirmed progression with the selected jutsu loadout and its ordered jutsu IDs. */
export const getSelectJutsuLoadoutUserUpdate = ({
  progressionUserPatch,
  id,
  loadoutJutsuIds,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  id: string;
  loadoutJutsuIds: string[];
}) => ({
  userPatch: {
    ...progressionUserPatch,
    jutsuLoadout: id,
    loadout: { jutsuIds: loadoutJutsuIds },
  },
});

/**
 * Combine the confirmed import projection with loadout fields only when the imported loadout
 * is active.
 */
export const getImportJutsuLoadoutUserUpdate = ({
  cacheUpdateUserPatch,
  isActive,
  loadoutId,
  previewJutsuIds,
}: {
  cacheUpdateUserPatch: UserCachePatch | undefined;
  isActive: boolean;
  loadoutId: string;
  previewJutsuIds: string[];
}) => ({
  userPatch: {
    ...cacheUpdateUserPatch,
    ...(isActive
      ? { jutsuLoadout: loadoutId, loadout: { jutsuIds: previewJutsuIds } }
      : {}),
  },
});

/**
 * Combine confirmed evolution progression with replacement jutsu IDs when the active loadout
 * is affected.
 */
export const getEvolveJutsuUserUpdate = ({
  progressionUserPatch,
  activeLoadout,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  activeLoadout:
    | {
        id: string;
        jutsuIds: string[];
      }
    | undefined;
}) => ({
  userPatch: {
    ...progressionUserPatch,
    ...(activeLoadout ? { loadout: { jutsuIds: activeLoadout.jutsuIds } } : {}),
  },
});

/** Credit the ryo refund confirmed by training cancellation. */
export const getCancelQueuedTrainingUserUpdate = ({
  cancelledRefunded,
}: {
  cancelledRefunded: number;
}) => ({
  userDelta: { money: cancelledRefunded },
});

/** Replace the active loadout's jutsu ordering with the saved sequence. */
export const getUpdateUserJutsuOrderUserUpdate = ({
  newOrder,
}: {
  newOrder: string[];
}) => ({
  userPatch: { loadout: { jutsuIds: newOrder } },
});

/** Apply a committed equip flag; filtered unequips need a read to resolve list membership. */
export const getEquippedJutsus = <
  T extends { id: string; jutsuId: string; equipped: boolean },
>(
  rows: T[],
  userJutsuId: string,
  change: { equipped: boolean; jutsuId: string } | undefined,
  input: UserJutsuFilteringSchema,
): T[] | undefined => {
  if (
    !change ||
    !rows.some((row) => row.id === userJutsuId && row.jutsuId === change.jutsuId)
  )
    return;
  if (
    !change.equipped &&
    input.includeEquipped &&
    Object.entries(input).some(
      ([key, value]) => key !== "includeEquipped" && value !== undefined,
    )
  )
    return;
  return rows.map((row) =>
    row.id === userJutsuId ? { ...row, equipped: change.equipped } : row,
  );
};

/** Keep the active loadout's IDs aligned with the confirmed equipment flag. */
export const getEquippedJutsuUserPatch = (
  jutsuIds: string[],
  change: { jutsuId: string; equipped: boolean },
) => ({
  loadout: {
    jutsuIds: change.equipped
      ? [...new Set([...jutsuIds, change.jutsuId])]
      : jutsuIds.filter((id) => id !== change.jutsuId),
  },
});
