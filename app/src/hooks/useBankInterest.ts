import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { useUserDelta } from "@/hooks/useUserDelta";
import { showMutationToast } from "@/libs/toast";
import { nextUtcDayAt } from "@/utils/time";

export const usePendingBankInterest = (enabled = true, timeDiff = 0) => {
  const query = api.bank.getPendingInterest.useQuery(undefined, {
    enabled,
    staleTime: 300_000,
  });
  useRefreshAt(
    [nextUtcDayAt(new Date(Date.now() - timeDiff))],
    () => {
      void query.refetch({ cancelRefetch: false });
    },
    timeDiff,
    enabled,
  );
  return query;
};

export const useClaimBankInterest = () => {
  const { onMutate, updateUserDelta } = useUserDelta();
  const utils = api.useUtils();
  return api.bank.claimInterest.useMutation({
    onMutate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUserDelta({}, revision, { bank: data.data.bank });
        await utils.bank.getPendingInterest.invalidate();
      }
    },
  });
};
