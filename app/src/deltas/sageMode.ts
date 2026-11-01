import type { UserQueueState } from "@/deltas/profile";
import { REMOVAL_COST } from "@/drizzle/constants";
import { hasEnergyQueue } from "@/libs/queue";

/** Debit the sage-mode removal fee unless queued energy work requires profile reconciliation. */
export const getRemoveSageModeUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -REMOVAL_COST },
});
