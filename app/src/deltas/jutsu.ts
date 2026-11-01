import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserQueueState } from "@/deltas/profile";
import { hasEnergyQueue } from "@/libs/queue";
import type { UserWithRelations } from "@/server/api/routers/profile";
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
  // includeEquipped admits rows that need not match the other filters.
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

/** Keep profile equipment on the confirmed active loadout and baseline; changed selections refetch. */
export const getEquippedJutsuProfilePatch = (
  user: Pick<NonNullable<UserWithRelations>, "jutsuLoadout" | "loadout">,
  change: RouterOutputs["jutsu"]["toggleEquip"]["data"],
) => {
  if (
    !change?.loadout ||
    user.jutsuLoadout !== change.loadout.id ||
    JSON.stringify(user.loadout?.jutsuIds) !== JSON.stringify(change.loadout.jutsuIds)
  )
    return;
  return getEquippedJutsuUserPatch(user.loadout?.jutsuIds ?? [], change);
};

/** Confirmed single-level training with no waiting jobs; timestamps also identify its sidebar timer. */
export type JutsuTrainingUpdate = {
  id: string;
  jutsuId: string;
  beforeLevel: number;
  level: number;
  name: string;
  trainingStartedAt: Date;
  finishTraining: Date;
};

/** Describe the existing ownership row only after its guarded level increment succeeds. */
export const getStartedJutsuTrainingUpdate = (
  owned: Pick<JutsuTrainingUpdate, "id" | "jutsuId"> & { level: number },
  name: string,
  trainingStartedAt: Date,
  finishTraining: Date,
): JutsuTrainingUpdate => ({
  id: owned.id,
  jutsuId: owned.jutsuId,
  name,
  beforeLevel: owned.level,
  level: owned.level + 1,
  trainingStartedAt,
  finishTraining,
});

/** Update known ownership without inventing a learned jutsu or replacing a different training level. */
export const getTrainingJutsus = (
  rows: RouterOutputs["jutsu"]["getUserJutsus"],
  update: JutsuTrainingUpdate,
) => {
  const current = rows.find(
    (row) => row.id === update.id && row.jutsuId === update.jutsuId,
  );
  if (!current || current.level !== update.beforeLevel) return;
  return rows.map((row) =>
    row.id === update.id
      ? {
          ...row,
          level: update.level,
          trainingStartedAt: update.trainingStartedAt,
          finishTraining: update.finishTraining,
          updatedAt: update.trainingStartedAt,
        }
      : row,
  );
};

/** A confirmed single-level start leaves an empty waiting queue unchanged; other baselines refetch. */
export const getUnchangedJutsuTrainingQueue = (
  current: RouterOutputs["jutsu"]["getTrainingQueue"],
) => (current.waiting.length === 0 ? current : undefined);

/** Replace only the jutsu timer when no active or waiting training conflicts with the confirmed start. */
export const getJutsuTrainingTimers = (
  current: RouterOutputs["profile"]["getSidebarTimers"],
  update: JutsuTrainingUpdate,
): RouterOutputs["profile"]["getSidebarTimers"] | undefined => {
  if (
    current.jutsuQueue.count ||
    (current.jutsuTraining &&
      current.jutsuTraining.finishTraining > update.trainingStartedAt)
  )
    return;
  const { name, level, trainingStartedAt, finishTraining } = update;
  return {
    ...current,
    jutsuTraining: { name, level, trainingStartedAt, finishTraining },
  };
};
