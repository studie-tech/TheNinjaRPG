import type { UserQueueState } from "@/delta/profile";
import { hasEnergyQueue } from "@/libs/queue";

import type { UserCachePatch } from "@/validators/userCache";

export const getTransferLevelUserUpdate = ({
  user,
  needsReputation,
  transferCost,
}: {
  user: UserQueueState;
  needsReputation: boolean;
  transferCost: number;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: needsReputation ? -transferCost : 0 },
});

export const getSelectJutsuLoadoutUserUpdate = ({
  progressionUserPatch,
  id,
  loadoutJutsuIds,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  id: string;
  loadoutJutsuIds: string[];
}) => ({
  userPatch: {
    ...progressionUserPatch,
    jutsuLoadout: id,
    loadout: { jutsuIds: loadoutJutsuIds },
  },
});

export const getImportJutsuLoadoutUserUpdate = ({
  cacheUpdateUserPatch,
  isActive,
  loadoutId,
  previewJutsuIds,
}: {
  cacheUpdateUserPatch: UserCachePatch | undefined;
  isActive: boolean;
  loadoutId: string;
  previewJutsuIds: string[];
}) => ({
  userPatch: {
    ...cacheUpdateUserPatch,
    ...(isActive
      ? { jutsuLoadout: loadoutId, loadout: { jutsuIds: previewJutsuIds } }
      : {}),
  },
});

export const getEvolveJutsuUserUpdate = ({
  progressionUserPatch,
  activeLoadout,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  activeLoadout:
    | {
        id: string;
        jutsuIds: string[];
      }
    | undefined;
}) => ({
  userPatch: {
    ...progressionUserPatch,
    ...(activeLoadout ? { loadout: { jutsuIds: activeLoadout.jutsuIds } } : {}),
  },
});

export const getCancelQueuedTrainingUserUpdate = ({
  cancelledRefunded,
}: {
  cancelledRefunded: number;
}) => ({
  userDelta: { money: cancelledRefunded },
});

export const getUpdateUserJutsuOrderUserUpdate = ({
  newOrder,
}: {
  newOrder: string[];
}) => ({
  userPatch: { loadout: { jutsuIds: newOrder } },
});
