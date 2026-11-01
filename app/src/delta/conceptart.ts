import type { UserQueueState } from "@/delta/profile";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import { hasEnergyQueue } from "@/libs/queue";

export const getCreateConceptArtUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_CONCEPT_IMAGE },
});

export const getCreateVideoUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_CONCEPT_VIDEO },
});
