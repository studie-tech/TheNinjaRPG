import type { UserRecovery } from "@/validators/base";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

/**
 * Forward profile fields present in a battle response only when both user and progression
 * state are settled; otherwise withhold them for reconciliation.
 */
export const getOverworldBattleResponseUpdate = ({
  requiresUserRefresh,
  requiresProgressionRefresh,
  battle,
}: {
  requiresUserRefresh: boolean;
  requiresProgressionRefresh: boolean;
  battle:
    | {
        success: false;
        message: string;
      }
    | ({
        success: boolean;
        message: string;
      } & {
        battleId?: string;
        requiresUserRefresh?: boolean;
        userPatch?: UserCachePatch;
        userDelta?: UserDelta;
        userRecovery?: UserRecovery;
      });
}) => ({
  userRecovery: "userRecovery" in battle ? battle.userRecovery : undefined,
  userPatch:
    !requiresUserRefresh && !requiresProgressionRefresh && "userPatch" in battle
      ? battle.userPatch
      : undefined,
  userDelta:
    !requiresUserRefresh && !requiresProgressionRefresh && "userDelta" in battle
      ? battle.userDelta
      : undefined,
});

/**
 * Increment the guarded daily roll count and clear a stale quest slot only after a confirmed
 * release. Unsettled profiles or unconfirmed releases withhold the projection.
 */
export const getOverworldRollUserUpdate = ({
  requiresUserRefresh,
  activeNpcQuestId,
  clearedStaleRowsAffected,
  activeUserDailyOverworldQuestRolls,
}: {
  requiresUserRefresh: boolean;
  activeNpcQuestId: string | null;
  clearedStaleRowsAffected: number | undefined;
  activeUserDailyOverworldQuestRolls: number;
}) => ({
  userPatch:
    !requiresUserRefresh && (!activeNpcQuestId || clearedStaleRowsAffected === 1)
      ? activeNpcQuestId
        ? { activeNpcQuestId: null }
        : {}
      : undefined,
  userDelta:
    !requiresUserRefresh && (!activeNpcQuestId || clearedStaleRowsAffected === 1)
      ? { dailyOverworldQuestRolls: 1 }
      : undefined,
  userExpected: {
    dailyOverworldQuestRolls: activeUserDailyOverworldQuestRolls,
  },
});

/**
 * Clear a released quest slot and increment the guarded daily roll count only after one
 * confirmed release on a settled profile.
 */
export const getReleasedOverworldQuestUserUpdate = ({
  requiresUserRefresh,
  releasedRowsAffected,
  activeUserDailyOverworldQuestRolls,
}: {
  requiresUserRefresh: boolean;
  releasedRowsAffected: number;
  activeUserDailyOverworldQuestRolls: number;
}) => ({
  userPatch:
    !requiresUserRefresh && releasedRowsAffected === 1
      ? { activeNpcQuestId: null }
      : undefined,
  userDelta:
    !requiresUserRefresh && releasedRowsAffected === 1
      ? { dailyOverworldQuestRolls: 1 }
      : undefined,
  userExpected: {
    dailyOverworldQuestRolls: activeUserDailyOverworldQuestRolls,
  },
});

/**
 * Combine the confirmed progression patch with the assigned quest and a daily roll increment
 * guarded by the opening count.
 */
export const getAssignedOverworldQuestUserUpdate = ({
  cacheUpdateUserPatch,
  chosenQuestId,
  activeUserDailyOverworldQuestRolls,
}: {
  cacheUpdateUserPatch: UserCachePatch | undefined;
  chosenQuestId: string;
  activeUserDailyOverworldQuestRolls: number;
}) => ({
  userPatch: {
    ...cacheUpdateUserPatch,
    activeNpcQuestId: chosenQuestId,
  },
  userDelta: { dailyOverworldQuestRolls: 1 },
  userExpected: {
    dailyOverworldQuestRolls: activeUserDailyOverworldQuestRolls,
  },
});

/**
 * Confirm unchanged profile fields for a settled overworld action; return undefined when a
 * refresh is required.
 */
export const getOverworldUnchangedPatch = (requiresUserRefresh: boolean) =>
  requiresUserRefresh ? undefined : {};
