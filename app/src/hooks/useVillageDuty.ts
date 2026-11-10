import { getQueryKey } from "@trpc/react-query";
import { useEffect, useRef, useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { getVillageDutySectorUpdate } from "@/deltas/villageDuty";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { MutationFeedback } from "@/layout/FeedbackAlert";
import { WANDER_STEP_MS } from "@/libs/overworldWander";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { showMutationToast } from "@/libs/toast";
import { useUserInfo } from "@/utils/UserContext";

/** Keep the shared roster and map tied to the village/sector captured when enrollment changes. */
export const useVillageDuty = (villageId: string, sector?: number) => {
  const { timeDiff } = useUserInfo();
  const utils = api.useUtils();
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const query = api.villageDuty.get.useQuery(
    { villageId },
    {
      enabled: !!villageId,
      refetchInterval: 30_000,
    },
  );
  const mutation = api.villageDuty.setDuty.useMutation({
    onMutate: () => {
      setFeedback(null);
      return { villageId, sector };
    },
    onSuccess: async (result, _input, snapshot) => {
      setFeedback(result);
      if (!result.success || !snapshot) return;
      // Volunteer counts change independently; a rotation can also publish unknown patrol identities.
      await Promise.all([
        utils.villageDuty.get.invalidate({ villageId: snapshot.villageId }),
        ...(snapshot.sector !== undefined
          ? [utils.travel.getSectorData.invalidate({ sector: snapshot.sector })]
          : []),
      ]);
    },
    onError: (error) => setFeedback({ success: false, message: error.message }),
  });
  return {
    ...query,
    timeDiff,
    feedback,
    isChanging: mutation.isPending,
    setDuty: (enabled: boolean) => mutation.mutate({ villageId, enabled }),
  };
};

/** Travel-only checks share the existing sector cache and sleep in hidden tabs; motion stays local to Pixi. */
export const useVillageDutyPursuit = ({
  sector,
  enabled,
  protectors,
  startedAt,
  revision,
}: {
  sector: number;
  enabled: boolean;
  protectors: SectorUser[];
  startedAt?: Date | null;
  revision?: number;
}) => {
  const { prepareUserUpdate, updateUser, pusher, userId, timeDiff } = useUserInfo();
  const cache = useQueryCacheUpdate<RouterOutputs["travel"]["getSectorData"]>(
    getQueryKey(api.travel.getSectorData, { sector }, "query"),
  );
  const lastCheck = useRef(0);
  const mutation = api.villageDuty.patrol.useMutation({
    onMutate: () => ({
      userRevision: prepareUserUpdate(),
      sector: cache.prepareUpdate(),
    }),
    onSuccess: async (result, _input, snapshot) => {
      if (!snapshot) return;
      await Promise.all([
        ...(result.patrolUpdate
          ? [
              cache.updateCache(
                (current) => getVillageDutySectorUpdate(current, result.patrolUpdate!),
                snapshot.sector,
              ),
            ]
          : []),
        ...(result.battleId || result.userRecovery || result.userPatch
          ? [updateUser(result, { revision: snapshot.userRevision, refetch: false })]
          : []),
      ]);
      if (!result.success) showMutationToast(result);
    },
    onError: (error) => showMutationToast({ success: false, message: error.message }),
  });
  const latest = useRef({
    enabled,
    protectors,
    mutation,
    userId,
    timeDiff,
    pusher,
    startedAt,
    revision,
  });
  latest.current = {
    enabled,
    protectors,
    mutation,
    userId,
    timeDiff,
    pusher,
    startedAt,
    revision,
  };
  useEffect(() => {
    const check = () => {
      const state = latest.current;
      if (!state.enabled || document.hidden || state.mutation.isPending) return;
      const now = Date.now() - state.timeDiff;
      const contact = state.protectors.some((protector) => {
        const pursuit = protector.npcWander?.pursuit;
        if (!pursuit || pursuit.targetUserId !== state.userId) return false;
        const reaches =
          pursuit.startedAt + Math.max(0, pursuit.path.length - 1) * WANDER_STEP_MS;
        return reaches <= now && reaches > lastCheck.current;
      });
      if (!contact && now - lastCheck.current < 10_000) return;
      lastCheck.current = now;
      state.mutation.mutate({
        sector,
        startedAt: state.startedAt ?? undefined,
        revision: state.revision,
        originSocketId: state.pusher?.connection.socket_id,
      });
    };
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [sector, enabled]);
};
