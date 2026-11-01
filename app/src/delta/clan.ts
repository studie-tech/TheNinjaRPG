import type { UserQueueState } from "@/delta/profile";
import { getMembershipUserPatch } from "@/delta/social";
import {
  CLAN_COLOR_CHANGE_REP_COST,
  STRONGHOLD_REESTABLISH_COST,
} from "@/drizzle/constants";
import type { Clan, UserData } from "@/drizzle/schema";
import { hasEnergyQueue } from "@/libs/queue";

import type { findMembershipUserCache } from "@/queries/socialUserCache";
import type { UserCachePatch } from "@/validators/userCache";

export const getUpgradeHideoutToStrongholdUserUpdate = ({
  fetchedClanId,
  clanHideoutId,
  lastMaintenancePaidAt,
}: {
  fetchedClanId: string;
  clanHideoutId: string;
  lastMaintenancePaidAt: Date;
}) => ({
  userDelta: { clan: { id: fetchedClanId, bank: -STRONGHOLD_REESTABLISH_COST } },
  userPatch: {
    village: {
      id: clanHideoutId,
      type: "STRONGHOLD" as const,
      belowMemberMinimumSince: null,
      lastMaintenancePaidAt,
    },
  },
});

export const getUnchangedClanUserUpdate = () => ({
  userDelta: {},
  userPatch: {},
});

export const getClanDonationUserUpdate = ({
  user,
  repsCost,
  fetchedClanId,
}: {
  user: UserQueueState;
  repsCost: number;
  fetchedClanId: string;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : {
        reputationPoints: -repsCost,
        // The INT treasury rounds fractional donations; personal reputation is FLOAT.
        clan: { id: fetchedClanId, repTreasury: Math.round(repsCost) },
      },
});

export const getEditClanColorUserUpdate = ({
  user,
  colorResultRowsAffected,
  fetchedClanVillageId,
  inputColor,
  fetchedClanId,
}: {
  user: UserQueueState;
  colorResultRowsAffected: number;
  fetchedClanVillageId: string;
  inputColor: string;
  fetchedClanId: string;
}) => ({
  userDelta:
    hasEnergyQueue(user) || colorResultRowsAffected === 0
      ? undefined
      : { reputationPoints: -CLAN_COLOR_CHANGE_REP_COST },
  userPatch: { village: { id: fetchedClanVillageId, hexColor: inputColor } },
  userExpected: { clanId: fetchedClanId },
});

export const getPromoteMemberUserUpdate = ({
  userClanId,
  fetchedClanId,
  updateData,
  isMemberColeader,
  hadHideout,
  userVillageId,
  fetchedClanVillageId,
  inputMemberId,
}: {
  userClanId: string | null;
  fetchedClanId: string;
  updateData:
    | {
        leaderId: string;
        coLeader1: string | null;
        coLeader2: string | null;
        coLeader3: string | null;
      }
    | {
        [x: string]: string;
      }
    | {
        coLeader1: string;
      }
    | {
        coLeader2: string;
      }
    | {
        coLeader3: string;
      };
  isMemberColeader: boolean;
  hadHideout: boolean;
  userVillageId: string | null;
  fetchedClanVillageId: string;
  inputMemberId: string;
}) => ({
  userPatch: {
    ...(userClanId === fetchedClanId
      ? { clan: { id: fetchedClanId, ...updateData } }
      : {}),
    ...(isMemberColeader && hadHideout && userVillageId === fetchedClanVillageId
      ? { village: { id: fetchedClanVillageId, kageId: inputMemberId } }
      : {}),
  },
});

export const getDemoteMemberUserUpdate = ({
  userClanId,
  clanDataId,
  updateData,
}: {
  userClanId: string | null;
  clanDataId: string;
  updateData: {
    coLeader1: string | null;
    coLeader2: string | null;
    coLeader3: string | null;
  };
}) => ({
  userPatch:
    userClanId === clanDataId
      ? {
          clan: {
            id: clanDataId,
            ...updateData,
          },
        }
      : {},
});

export const getKickMemberUserUpdate = ({
  fetchedClanVillageType,
  memberUserId,
  ctxUserId,
  user,
  settings,
  fetchedClanId,
  membership,
}: {
  fetchedClanVillageType: "VILLAGE" | "OUTLAW" | "SAFEZONE" | "HIDEOUT" | "STRONGHOLD";
  memberUserId: string;
  ctxUserId: string;
  user: UserData | NonNullable<Awaited<ReturnType<typeof findMembershipUserCache>>>;
  settings:
    | {
        id: string;
        name: string;
        value: number;
        time: Date;
      }[]
    | undefined;
  fetchedClanId: string;
  membership: UserCachePatch | undefined;
}) => ({
  userPatch: ["HIDEOUT", "STRONGHOLD"].includes(fetchedClanVillageType ?? "")
    ? undefined
    : memberUserId === ctxUserId
      ? user.status === "AWAKE" && !user.isOutlaw && settings && "bloodline" in user
        ? getMembershipUserPatch(user, null, settings)
        : undefined
      : user.clanId === fetchedClanId
        ? membership
        : {},
});

export const getLeaveClanUserUpdate = ({
  user,
  settings,
}: {
  user: NonNullable<Awaited<ReturnType<typeof findMembershipUserCache>>>;
  settings: {
    id: string;
    name: string;
    value: number;
    time: Date;
  }[];
}) => ({
  userPatch: user.isOutlaw ? undefined : getMembershipUserPatch(user, null, settings),
});

export const getConvertPointsToRyoUserUpdate = ({
  fetchedClanId,
  inputPoints,
  ryo,
}: {
  fetchedClanId: string;
  inputPoints: number;
  ryo: number;
}) => ({
  userDelta: { clan: { id: fetchedClanId, points: -inputPoints, bank: ryo } },
});

export const getToBankUserUpdate = ({
  needsUserRefresh,
  inputAmount,
  fetchedClanId,
}: {
  needsUserRefresh: boolean;
  inputAmount: number;
  fetchedClanId: string;
}) => ({
  userDelta: needsUserRefresh
    ? undefined
    : { money: -inputAmount, clan: { id: fetchedClanId, bank: inputAmount } },
});

export const getJoinClanBattleUserUpdate = () => ({
  userPatch: { status: "QUEUED" as const },
});

export const getLeaveClanBattleUserUpdate = ({
  wokeRowsAffected,
}: {
  wokeRowsAffected: number | undefined;
}) => ({
  userPatch: wokeRowsAffected ? { status: "AWAKE" as const } : undefined,
});

export const getKickFromClanBattleUserUpdate = ({
  inputTargetId,
  ctxUserId,
  wokeRowsAffected,
}: {
  inputTargetId: string;
  ctxUserId: string;
  wokeRowsAffected: number | undefined;
}) => ({
  userPatch:
    inputTargetId === ctxUserId
      ? wokeRowsAffected
        ? { status: "AWAKE" as const }
        : undefined
      : {},
});

export const getInstantJoinAndLeadUserUpdate = ({
  user,
  fetchedClanVillageId,
  fetchedClanVillageType,
  savedClan,
  settings,
}: {
  user: NonNullable<Awaited<ReturnType<typeof findMembershipUserCache>>>;
  fetchedClanVillageId: string;
  fetchedClanVillageType: "VILLAGE" | "OUTLAW" | "SAFEZONE" | "HIDEOUT" | "STRONGHOLD";
  savedClan: Clan;
  settings: {
    id: string;
    name: string;
    value: number;
    time: Date;
  }[];
}) => ({
  userPatch:
    user.villageId !== fetchedClanVillageId ||
    ["HIDEOUT", "STRONGHOLD"].includes(fetchedClanVillageType ?? "")
      ? undefined
      : getMembershipUserPatch(
          user,
          {
            ...savedClan,
            leaderId: user.userId,
            coLeader1: null,
            coLeader2: null,
            coLeader3: null,
          },
          settings,
        ),
});
