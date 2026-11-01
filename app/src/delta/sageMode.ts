import type { UserQueueState } from "@/delta/profile";
import { REMOVAL_COST } from "@/drizzle/constants";
import { hasEnergyQueue } from "@/libs/queue";

export const getRemoveSageModeUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -REMOVAL_COST },
});
