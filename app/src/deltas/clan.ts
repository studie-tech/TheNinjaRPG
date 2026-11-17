import type { UserQueueState } from "@/deltas/profile";
import { getMembershipUserPatch } from "@/deltas/social";
import {
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CLAN_COLOR_CHANGE_REP_COST,
  type ClanBoostType,
  STRONGHOLD_REESTABLISH_COST,
} from "@/drizzle/constants";
import type { Clan, GameSetting, UserData } from "@/drizzle/schema";
import { hasEnergyQueue } from "@/libs/queue";

import type { fetchClan } from "@/queries/clan";
import type { findMembershipUserCache } from "@/queries/socialUserCache";
import { mergeQueryChanges } from "@/utils/queryCache";
import type { ClanDelta } from "@/validators/clan";
import type { UserCachePatch } from "@/validators/userCache";

/** Debit the clan treasury and project the confirmed stronghold type and maintenance state. */
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

/** Confirm that a clan operation changed neither profile fields nor cached balances. */
export const getUnchangedClanUserUpdate = ({ clanId }: { clanId: string }) => ({
  userDelta: {},
  userPatch: {},
  clanDelta: { id: clanId },
});

/**
 * Debit personal reputation and credit the clan treasury by the whole donated amount.
 * Queued energy work withholds the profile delta; the treasury credit stays known.
 */
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
        clan: { id: fetchedClanId, repTreasury: repsCost },
      },
  clanDelta: { id: fetchedClanId, repTreasury: repsCost },
});

/**
 * Project the saved village color with an expected clan identity. Withhold its reputation
 * debit when the color write affected no rows or energy work is queued.
 */
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

/**
 * Project leadership changes only into the caller's matching clan and hideout village
 * relations.
 */
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

/** Project the saved co-leader slots only when the caller belongs to the affected clan. */
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

/**
 * Project the caller's affected clan membership from loaded sources. Self-removal requires an
 * awake non-outlaw snapshot; hideout and stronghold removals require a canonical read.
 */
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
  settings: GameSetting[] | undefined;
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

/**
 * Remove clan membership and recompute its regeneration effects for ordinary members. Outlaw
 * departures require a canonical profile read.
 */
export const getLeaveClanUserUpdate = ({
  user,
  settings,
}: {
  user: NonNullable<Awaited<ReturnType<typeof findMembershipUserCache>>>;
  settings: GameSetting[];
}) => ({
  userPatch: user.isOutlaw ? undefined : getMembershipUserPatch(user, null, settings),
});

/** Exchange confirmed clan points for ryo in the matching clan treasury. */
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
  clanDelta: { id: fetchedClanId, points: -inputPoints, bank: ryo },
});

/**
 * Transfer personal ryo into the clan treasury. The profile delta is withheld when the
 * opening profile requires reconciliation; the treasury credit stays known.
 */
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
  clanDelta: { id: fetchedClanId, bank: inputAmount },
});

/**
 * Debit the boost cost from the clan bank and raise the purchased boost by one level. The
 * write matched the boost value it read, so the increment is exact.
 */
export const getPurchaseBoostClanUpdate = ({
  clanId,
  boostType,
  cost,
}: {
  clanId: string;
  boostType: ClanBoostType;
  cost: number;
}): { clanDelta: ClanDelta } => ({
  clanDelta: { id: clanId, bank: -cost, [boostType]: CLAN_BOOST_PERCENT_PER_LEVEL },
});

/**
 * Apply a confirmed clan delta to a cached `clan.get` result. Return undefined when the
 * cache holds no clan or a different one, so the query is fetched again.
 */
export const applyClanDelta = (
  current: CachedClan | null | undefined,
  delta: ClanDelta,
): CachedClan | undefined => {
  if (!current) return undefined;
  return mergeQueryChanges(current, {}, delta);
};

/** Project the caller's confirmed admission to a clan battle queue. */
export const getJoinClanBattleUserUpdate = () => ({
  userPatch: { status: "QUEUED" as const },
});

/** Wake the cached caller only when the guarded queue-exit write affected a row. */
export const getLeaveClanBattleUserUpdate = ({
  wokeRowsAffected,
}: {
  wokeRowsAffected: number | undefined;
}) => ({
  userPatch: wokeRowsAffected ? { status: "AWAKE" as const } : undefined,
});

/**
 * Wake a removed caller only after a confirmed write; removing another user leaves the
 * caller's profile unchanged.
 */
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

/**
 * Project clan leadership and recompute membership effects for a same-village join. Village
 * changes and hideout or stronghold joins require a canonical read.
 */
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
  settings: GameSetting[];
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

/** The clan row and relations that `clan.get` caches. */
type CachedClan = NonNullable<Awaited<ReturnType<typeof fetchClan>>>;
