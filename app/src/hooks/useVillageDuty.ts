import { useState } from "react";
import { api } from "@/app/_trpc/client";
import type { MutationFeedback } from "@/layout/FeedbackAlert";

/** Keep the shared roster and map tied to the village/sector captured when enrollment changes. */
export const useVillageDuty = (villageId: string, sector?: number) => {
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
      // The shared roster can change independently and its capped sample can gain an unknown member.
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
    feedback,
    isChanging: mutation.isPending,
    setDuty: (enabled: boolean) => mutation.mutate({ villageId, enabled }),
  };
};
