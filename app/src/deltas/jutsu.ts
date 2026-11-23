import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserQueueState } from "@/deltas/profile";
import { getSavedTrainingQueueUserUpdate } from "@/deltas/train";
import type { UserQueue } from "@/drizzle/schema";
import { hasEnergyQueue } from "@/libs/queue";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { JutsuLevelTransfer, UserJutsuFilteringSchema } from "@/validators/jutsu";
import type { QuestTrackerType } from "@/validators/objectives";
import type { UserCachePatch, UserDeltaResponse } from "@/validators/userCache";

/** Project confirmed training charges, generated queue rows and public quest progress from the loaded actor. */
export const getStartedJutsuUserUpdate = ({
  user,
  cost,
  queue,
  questData,
  requiresProgressionRefresh,
  publishedAchievementIds,
  equippedJutsus,
  learnedJutsu,
}: {
  user: Parameters<typeof getSavedTrainingQueueUserUpdate>[0]["user"];
  cost: number;
  queue: UserQueue[];
  questData: QuestTrackerType[] | null;
  requiresProgressionRefresh: boolean;
  publishedAchievementIds: readonly string[];
  equippedJutsus?: { jutsuId: string }[];
  learnedJutsu?: { jutsuId: string; equipped: boolean };
}) => {
  const projection: Pick<UserDeltaResponse, "userPatch" | "achievementProgress"> =
    getSavedTrainingQueueUserUpdate({
      user,
      saved: { queue: [...(user.queue ?? []), ...queue], questData },
      requiresProgressionRefresh,
      publishedAchievementIds,
    });
  return {
    ...projection,
    userPatch: projection.userPatch
      ? {
          ...projection.userPatch,
          ...(equippedJutsus
            ? {
                jutsus: [
                  ...equippedJutsus.map(({ jutsuId }) => ({ jutsuId })),
                  ...(learnedJutsu?.equipped
                    ? [{ jutsuId: learnedJutsu.jutsuId }]
                    : []),
                ],
              }
            : {}),
        }
      : undefined,
    userDelta: projection.userPatch ? { money: -cost } : undefined,
  };
};

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

/**
 * Point the profile at the selected jutsu loadout, its ordered jutsu IDs and the AI rules it
 * fights with (null for the Default rules).
 */
export const getSelectJutsuLoadoutUserUpdate = ({
  id,
  loadoutJutsuIds,
  aiProfileId,
  equippedJutsus,
}: {
  id: string;
  loadoutJutsuIds: string[];
  aiProfileId: string | null;
  equippedJutsus: { jutsuId: string }[];
}) => ({
  userPatch: {
    jutsuLoadout: id,
    aiProfileId,
    loadout: { jutsuIds: loadoutJutsuIds },
    jutsus: equippedJutsus.map(({ jutsuId }) => ({ jutsuId })),
  },
});

/** Clear actual equipment and the selected loadout when one exists. */
export const getUnequipAllJutsuUserUpdate = (
  clearedActiveLoadout: boolean,
): Pick<UserDeltaResponse, "userPatch" | "userDelta"> =>
  clearedActiveLoadout
    ? { userPatch: { loadout: { jutsuIds: [] }, jutsus: [] } }
    : { userPatch: { jutsus: [] } };

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
      ? {
          jutsuLoadout: loadoutId,
          loadout: { jutsuIds: previewJutsuIds },
          jutsus: previewJutsuIds.map((jutsuId) => ({ jutsuId })),
        }
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
  userJutsus,
  previousJutsuId,
  evolutionJutsuId,
  isRestrictedEquipType,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  userJutsus: { jutsuId: string; equipped: boolean }[];
  previousJutsuId: string;
  evolutionJutsuId: string;
  isRestrictedEquipType: boolean;
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
    jutsus: userJutsus.flatMap((row) =>
      !row.equipped || (row.jutsuId === previousJutsuId && isRestrictedEquipType)
        ? []
        : [
            {
              jutsuId: row.jutsuId === previousJutsuId ? evolutionJutsuId : row.jutsuId,
            },
          ],
    ),
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

/** Remove a confirmed forgotten jutsu; a row missing from the loaded list refetches. */
export const getForgottenJutsus = <T extends { id: string }>(
  rows: T[],
  userJutsuId: string,
): T[] | undefined =>
  rows.some((row) => row.id === userJutsuId)
    ? rows.filter((row) => row.id !== userJutsuId)
    : undefined;

/** Remove confirmed forgotten equipment from the profile so its warning follows actual equips, independently of saved loadout IDs. */
export const getForgottenJutsuProfilePatch = (
  user: Pick<NonNullable<UserWithRelations>, "jutsus">,
  owned: { id: string; jutsuId: string } | undefined,
  userJutsuId: string,
) => {
  if (!user.jutsus || !owned || owned.id !== userJutsuId) return;
  return { jutsus: user.jutsus.filter((row) => row.jutsuId !== owned.jutsuId) };
};

/** Project actual equipment after confirmed requirement invalidations so warnings do not follow stale saved loadout IDs. */
export const getInvalidatedJutsuUserUpdate = (
  rows: { jutsuId: string; equipped: boolean }[],
  invalidatedJutsuIds: string[],
) => ({
  userPatch: {
    jutsus: rows
      .filter((row) => row.equipped && !invalidatedJutsuIds.includes(row.jutsuId))
      .map(({ jutsuId }) => ({ jutsuId })),
  },
});

/** Clear every equip flag; filtered lists that admit equipped rows need a read for membership. */
export const getUnequippedJutsus = <T extends { equipped: boolean }>(
  rows: T[],
  input: UserJutsuFilteringSchema,
): T[] | undefined => {
  if (
    input.includeEquipped &&
    Object.entries(input).some(
      ([key, value]) => key !== "includeEquipped" && value !== undefined,
    )
  )
    return;
  return rows.map((row) => (row.equipped ? { ...row, equipped: false } : row));
};

/** Move confirmed transferred levels between loaded baselines; any mismatch refetches. */
export const getTransferredJutsus = <T extends { id: string; level: number }>(
  rows: T[],
  transfer: JutsuLevelTransfer | undefined,
): T[] | undefined => {
  if (
    !transfer ||
    !rows.some(
      (row) => row.id === transfer.fromUserJutsuId && row.level === transfer.fromLevel,
    ) ||
    !rows.some(
      (row) => row.id === transfer.toUserJutsuId && row.level === transfer.toLevel,
    )
  )
    return;
  return rows.map((row) =>
    row.id === transfer.fromUserJutsuId
      ? { ...row, level: transfer.fromLevel - transfer.levels }
      : row.id === transfer.toUserJutsuId
        ? { ...row, level: transfer.toLevel + transfer.levels }
        : row,
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
  user: Pick<NonNullable<UserWithRelations>, "jutsuLoadout" | "loadout" | "jutsus">,
  change: RouterOutputs["jutsu"]["toggleEquip"]["data"],
) => {
  if (
    !user.jutsus ||
    !change?.loadout ||
    user.jutsuLoadout !== change.loadout.id ||
    JSON.stringify(user.loadout?.jutsuIds) !== JSON.stringify(change.loadout.jutsuIds)
  )
    return;
  return {
    ...getEquippedJutsuUserPatch(user.loadout?.jutsuIds ?? [], change),
    jutsus: change.equipped
      ? [...new Set([...user.jutsus.map((row) => row.jutsuId), change.jutsuId])].map(
          (jutsuId) => ({ jutsuId }),
        )
      : user.jutsus.filter((row) => row.jutsuId !== change.jutsuId),
  };
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
