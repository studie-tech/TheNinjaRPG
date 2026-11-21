import { getPublicQuestUser } from "@/libs/quest/projection";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

/**
 * The profile change of a minigame challenge claim: the player's public quest trackers
 * once the challenge objective is done, with the status of any battle a following
 * objective started, and none otherwise, since a challenge pays nothing else.
 */
export const getQuestChallengeUserUpdate = (
  completedFor: Parameters<typeof getPublicQuestUser>[0] | undefined,
  battle?: { userDelta?: UserDelta; userPatch?: UserCachePatch },
): { userDelta: UserDelta; userPatch?: UserCachePatch } =>
  completedFor
    ? {
        userDelta: { ...battle?.userDelta },
        userPatch: {
          ...battle?.userPatch,
          questData: getPublicQuestUser(completedFor).questData,
        },
      }
    : { userDelta: {} };
