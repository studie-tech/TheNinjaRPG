import type { UserCachePatch, UserDelta } from "@/validators/userCache";

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
      });
}) => ({
  userPatch:
    !requiresUserRefresh && !requiresProgressionRefresh && "userPatch" in battle
      ? battle.userPatch
      : undefined,
  userDelta:
    !requiresUserRefresh && !requiresProgressionRefresh && "userDelta" in battle
      ? battle.userDelta
      : undefined,
});

export const getOverworldBattleUserUpdate = ({
  requiresUserRefresh,
  requiresProgressionRefresh,
  battleUserPatch,
  battleUserDelta,
}: {
  requiresUserRefresh: boolean;
  requiresProgressionRefresh: boolean;
  battleUserPatch: UserCachePatch | undefined;
  battleUserDelta: UserDelta | undefined;
}) => ({
  userPatch:
    !requiresUserRefresh && !requiresProgressionRefresh ? battleUserPatch : undefined,
  userDelta:
    !requiresUserRefresh && !requiresProgressionRefresh ? battleUserDelta : undefined,
});

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

export const getOverworldUnchangedPatch = (requiresUserRefresh: boolean) =>
  requiresUserRefresh ? undefined : {};
