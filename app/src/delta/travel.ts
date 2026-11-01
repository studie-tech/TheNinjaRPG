import type { UserData } from "@/drizzle/schema";
import { getPublicQuestUser } from "@/libs/quest";
import type { UserWithRelations } from "@/server/api/routers/profile";

export const getFinishGlobalMoveUserUpdate = ({
  claimSuccess,
  claimClaimedAt,
  arrival,
  trackers,
}: {
  claimSuccess: boolean;
  claimClaimedAt: Date;
  arrival: NonNullable<UserWithRelations>;
  trackers: NonNullable<UserData["questData"]>;
}) => {
  const publicArrival = getPublicQuestUser({ ...arrival, questData: trackers });
  return {
    userDelta: {},
    userPatch: {
      status: "AWAKE" as const,
      travelFinishAt: null,
      ...(claimSuccess ? { updatedAt: claimClaimedAt } : {}),
      userQuests: publicArrival.userQuests,
      questData: publicArrival.questData,
    },
  };
};
