import {
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BOOST_COST,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
} from "@/drizzle/constants";
import type { fetchUpdatedUser, UserWithRelations } from "@/routers/profile";

export const getUpgradeShrineUserUpdate = ({
  requiresUserRefresh,
  userVillageId,
}: {
  requiresUserRefresh: boolean;
  userVillageId: string;
}) => ({
  userDelta: requiresUserRefresh
    ? undefined
    : { village: { id: userVillageId, tokens: -SHRINE_UPGRADE_COST } },
});

export const getActivateBoostUserUpdate = ({
  userVillageId,
  inputBoostType,
  boostExpiry,
  requiresUserRefresh,
}: {
  userVillageId: string;
  inputBoostType: "Training" | "PVP" | "Mission" | "Errands" | "Crafting";
  boostExpiry: Date;
  requiresUserRefresh: boolean;
}) => ({
  userPatch: {
    village: {
      id: userVillageId,
      shrineSettings: {
        activeBoosts: { [inputBoostType]: boostExpiry.toISOString() },
      },
    },
  },
  userDelta: requiresUserRefresh
    ? undefined
    : { village: { id: userVillageId, tokens: -SHRINE_BOOST_COST } },
});

export const getUnlockAiDefenderUserUpdate = ({
  userVillageId,
  updatedUnlocks,
  requiresUserRefresh,
}: {
  userVillageId: string;
  updatedUnlocks: string[];
  requiresUserRefresh: boolean;
}) => ({
  userPatch: {
    village: {
      id: userVillageId,
      shrineSettings: { unlockedAiIds: updatedUnlocks },
    },
  },
  userDelta: requiresUserRefresh
    ? undefined
    : { village: { id: userVillageId, tokens: -SHRINE_AI_UNLOCK_COST } },
});

export const getToggleVillageAiDefenderUserUpdate = ({
  userVillageId,
  newAssigns,
  requiresUserRefresh,
}: {
  userVillageId: string;
  newAssigns: string[];
  requiresUserRefresh: boolean;
}) => ({
  userPatch: {
    village: {
      id: userVillageId,
      shrineSettings: { activeAiIds: newAssigns },
    },
  },
  userDelta: requiresUserRefresh ? undefined : {},
});

export const getPayWeeklyMaintenanceUserUpdate = ({
  requiresUserRefresh,
  userVillageId,
}: {
  requiresUserRefresh: boolean;
  userVillageId: string;
}) => ({
  userDelta: requiresUserRefresh
    ? undefined
    : {
        village: { id: userVillageId, tokens: -SHRINE_WEEKLY_MAINTENANCE_COST },
      },
});

export const getSetBoostTemplateUserUpdate = ({
  userVillageId,
  inputTemplate,
  userUsername,
  templateUpdatedAt,
  requiresUserRefresh,
}: {
  userVillageId: string;
  inputTemplate: {
    boostType: "Training" | "PVP" | "Mission" | "Errands" | "Crafting";
    dayOfWeek: number;
    slotIndex: number;
  }[];
  userUsername: string;
  templateUpdatedAt: string;
  requiresUserRefresh: boolean;
}) => ({
  userPatch: {
    village: {
      id: userVillageId,
      shrineSettings: {
        boostTemplate: inputTemplate,
        boostTemplateUpdatedBy: userUsername,
        boostTemplateUpdatedAt: templateUpdatedAt,
      },
    },
  },
  userDelta: requiresUserRefresh ? undefined : {},
});

export const getChallengeShrineUserUpdate = ({
  requiresUserRefresh,
  user,
  attackerSide,
  targetSectorVillageId,
  shrineBattleId,
  createdAt,
  inputSectorNumber,
}: {
  requiresUserRefresh: boolean;
  user: NonNullable<UserWithRelations>;
  attackerSide: string;
  targetSectorVillageId: string;
  shrineBattleId: string;
  createdAt: Date;
  inputSectorNumber: number;
}) => ({
  userPatch: requiresUserRefresh
    ? undefined
    : {
        status: "QUEUED" as const,
        shrineBattles: [
          ...((user as NonNullable<UserWithRelations>).shrineBattles ?? []),
          ...(attackerSide === user.villageId ||
          targetSectorVillageId === user.villageId
            ? [
                {
                  id: shrineBattleId,
                  createdAt,
                  battleType: "SHRINE_BATTLE" as const,
                  attackerEntityId: attackerSide,
                  defenderEntityId: targetSectorVillageId,
                  sector: inputSectorNumber,
                  battleId: null,
                  winnerId: null,
                  territoryWarId: null,
                },
              ]
            : []),
        ],
      },
});

export const getJoinShrineBattleUserUpdate = ({
  requiresUserRefresh,
}: {
  requiresUserRefresh: boolean;
}) => ({
  userPatch: requiresUserRefresh ? undefined : { status: "QUEUED" as const },
});

export const getShrineQueueWakeUserUpdate = ({
  requiresUserRefresh,
  wakeRowsAffected,
  user,
}: {
  requiresUserRefresh: boolean;
  wakeRowsAffected: number;
  user: NonNullable<NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>>["user"]>;
}) => ({
  userPatch:
    !requiresUserRefresh && wakeRowsAffected === 1
      ? {
          status: "AWAKE" as const,
          shrineBattles: (user as NonNullable<UserWithRelations>).shrineBattles ?? [],
        }
      : undefined,
});

export const getLeftShrineBattleUserUpdate = ({
  requiresUserRefresh,
  wakeRowsAffected,
  remaining,
  removedRowsAffected,
  user,
  inputShrineBattleId,
}: {
  requiresUserRefresh: boolean;
  wakeRowsAffected: number;
  remaining: number;
  removedRowsAffected: number | undefined;
  user: NonNullable<NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>>["user"]>;
  inputShrineBattleId: string;
}) => ({
  userPatch:
    !requiresUserRefresh &&
    wakeRowsAffected === 1 &&
    (remaining > 0 || removedRowsAffected === 1)
      ? {
          status: "AWAKE" as const,
          shrineBattles: (
            (user as NonNullable<UserWithRelations>).shrineBattles ?? []
          ).filter((entry) => remaining > 0 || entry.id !== inputShrineBattleId),
        }
      : undefined,
});
