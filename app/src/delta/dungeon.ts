import type { DungeonRun, UserData } from "@/drizzle/schema";

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

export const getUnchangedDungeonUserUpdate = () => ({
  userDelta: {},
});

export const getCreatedDungeonUserUpdate = ({ id }: { id: string }) => ({
  userPatch: { status: "QUEUED" as const, activeDungeonRunId: id },
});

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

import { getRewardUserDelta } from "@/delta/quests";

import type { ActivityCompletions } from "@/server/utils/achievementObjectives";
import type { PostProcessedRewards } from "@/validators/rewards";

/** Confirmed scalar delivery returns its known delta and opening completion count. */
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
