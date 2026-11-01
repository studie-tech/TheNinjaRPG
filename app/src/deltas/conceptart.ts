import type { UserQueueState } from "@/deltas/profile";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import { hasEnergyQueue } from "@/libs/queue";

/**
 * Debit the concept-image generation cost unless queued energy work requires profile
 * reconciliation.
 */
export const getCreateConceptArtUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_CONCEPT_IMAGE },
});

/**
 * Debit the concept-video generation cost unless queued energy work requires profile
 * reconciliation.
 */
export const getCreateVideoUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_CONCEPT_VIDEO },
});
