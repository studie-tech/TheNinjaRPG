import { getRewardUserDelta } from "@/deltas/quests";
import type { DungeonRun, UserData } from "@/drizzle/schema";
import type { ActivityCompletions } from "@/server/utils/achievementObjectives";
import type { PostProcessedRewards } from "@/validators/rewards";

/**
 * Build expected status, battle and active-run guards from loaded dungeon state. Confirm an
 * unchanged patch only when the actor does not require a refresh.
 */
export const getDungeonStateUserUpdate = ({
  requiresUserRefresh,
  actor,
  members,
  ctxUserId,
  currentRuns,
}: {
  requiresUserRefresh: boolean;
  actor: Pick<UserData, "status" | "battleId"> | undefined;
  members: { runId: string; activeUserId: string | null }[];
  ctxUserId: string;
  currentRuns: Pick<DungeonRun, "id" | "status">[];
}) => ({
  userPatch: requiresUserRefresh ? undefined : {},
  userExpected: {
    ...(actor ? { status: actor.status, battleId: actor.battleId } : {}),
    activeDungeonRunId:
      members.find(
        (member) =>
          member.activeUserId === ctxUserId &&
          currentRuns.some((run) => run.id === member.runId && run.status !== "ENDED"),
      )?.runId ?? null,
  },
});

/** Confirm that a dungeon operation has no profile balance changes. */
export const getUnchangedDungeonUserUpdate = () => ({
  userDelta: {},
});

/** Project the creator's queue status and newly active dungeon run. */
export const getCreatedDungeonUserUpdate = ({ id }: { id: string }) => ({
  userPatch: { status: "QUEUED" as const, activeDungeonRunId: id },
});

/**
 * Project a confirmed dungeon join; ending a run or removing the caller requires
 * reconciliation. Other lobby actions leave the profile unchanged.
 */
export const getActUserUpdate = ({
  joined,
  runId,
  ending,
  removedUser,
  ctxUserId,
}: {
  joined: boolean;
  runId: string;
  ending: boolean;
  removedUser: string | undefined;
  ctxUserId: string;
}) => ({
  userPatch: joined
    ? { status: "QUEUED" as const, activeDungeonRunId: runId }
    : ending || removedUser === ctxUserId
      ? undefined
      : {},
});

/**
 * Pair supported scalar rewards with the opening dungeon completion count and its guard.
 * Withhold both patch and delta for unknown rewards or XP that can advance progression.
 */
export const getDungeonRewardUserUpdate = (
  before: ActivityCompletions,
  rewards: PostProcessedRewards | undefined,
) => {
  const delta = rewards && getRewardUserDelta(rewards);
  if (!delta || (rewards?.reward_exp ?? 0) > 0)
    return { userPatch: undefined, userDelta: undefined };
  return {
    userPatch: { dungeonsCompleted: before.dungeonsCompleted },
    userExpected: { dungeonsCompleted: before.dungeonsCompleted },
    userDelta: delta,
  };
};
